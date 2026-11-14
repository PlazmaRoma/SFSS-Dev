"""Команда sfss: демон и обращения к нему из терминала.

Сам CLI ничего не вычисляет: predict и ask ходят в демон по тому же API, что и
любая сторонняя программа. Поэтому модели и индекс здесь не импортируются, и
команда отвечает сразу, а не через 12 секунд загрузки эмбеддингов.
"""

import argparse
import csv
import io
import json
import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from collections import deque
from pathlib import Path

import httpx

from app.config import BASE_DIR, get_settings
from app.security import is_loopback
from app.services.llm_config import (
    DEFAULT_PORTS,
    ConfigError,
    LLMConfigPatch,
    ModelPatch,
    RuntimePatch,
    apply_patch,
    forget_config,
    load_config,
    save_config,
)
from app.services.llm_runtime import make_runtime

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
# Прогрев 4-16 с, но на холодном диске и в свопе бывает заметно дольше
START_TIMEOUT = 180.0
STOP_TIMEOUT = 15.0
# Ответ модели идёт без единого байта, пока пишется английский черновик для
# русского ответа. Потолок 120 с (lm_studio_timeout) на каждый вызов.
ASK_SILENCE_TIMEOUT = 180.0
# Индексация отчёта на сотни страниц идёт минуты
IMPORT_TIMEOUT = 900.0
LOAD_TIMEOUT = 200.0

PSI_TO_MMHG = 51.7149
AIR = {"pressure_mmhg": 760.0, "oxygen_level": 0.21, "n2": 0.79, "co2": 0.0, "he": 0.0}

EXIT_ERROR = 1
EXIT_NOT_RUNNING = 3


class CliError(Exception):
    """Ошибка, которую человек может исправить: печатается без трассировки."""

    def __init__(self, message: str, code: int = EXIT_ERROR) -> None:
        super().__init__(message)
        self.code = code


# --- Состояние демона ---------------------------------------------------------


def run_dir() -> Path:
    return get_settings().run_dir


def state_path() -> Path:
    return run_dir() / "sfss.json"


def log_path() -> Path:
    return run_dir() / "sfss.log"


def read_state() -> dict | None:
    try:
        return json.loads(state_path().read_text())
    except (OSError, ValueError):
        return None


def clear_state() -> None:
    state_path().unlink(missing_ok=True)


def is_ours(pid: int) -> bool:
    """Жив ли процесс и наш ли это uvicorn.

    Одной проверки pid мало: после перезагрузки номер мог достаться чужому
    процессу, и sfss stop убил бы его.
    """
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True
    )
    return result.returncode == 0 and "app.main:app" in result.stdout


def base_url(args: argparse.Namespace) -> str:
    """Адрес демона: явный --url, SFSS_URL, адрес из sfss start, иначе по умолчанию."""
    url = getattr(args, "url", None) or os.environ.get("SFSS_URL")
    if url:
        return url.rstrip("/")
    state = read_state() or {}
    host = state.get("host", DEFAULT_HOST)
    # 0.0.0.0 — адрес, который слушают, а не тот, по которому подключаются
    host = DEFAULT_HOST if host == "0.0.0.0" else host
    return f"http://{host}:{state.get('port', DEFAULT_PORT)}"


def make_client(url: str, read_timeout: float = 30.0) -> httpx.Client:
    timeout = httpx.Timeout(read_timeout, connect=3.0)
    key = get_settings().sfss_api_key
    headers = {"X-API-Key": key} if key else {}
    return httpx.Client(base_url=url, timeout=timeout, headers=headers)


def is_local_host(host: str) -> bool:
    return host == "localhost" or is_loopback(host)


def port_busy(host: str, port: int) -> bool:
    target = DEFAULT_HOST if host == "0.0.0.0" else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        return probe.connect_ex((target, port)) == 0


def tail(path: Path, lines: int) -> list[str]:
    try:
        with path.open(errors="replace") as file:
            return list(deque(file, maxlen=lines))
    except OSError:
        return []


# --- start / stop / status / logs ---------------------------------------------


def cmd_start(args: argparse.Namespace) -> int:
    state = read_state()
    if state and is_ours(state["pid"]):
        url = base_url(args)
        print(f"SFSS уже запущен: {url}, pid {state['pid']}")
    else:
        if not is_local_host(args.host) and not get_settings().sfss_api_key:
            raise CliError(
                f"Адрес {args.host} виден из сети, а ключа нет: без него API откажет "
                "всем снаружи. Задайте SFSS_API_KEY в .env"
            )
        url = f"http://{DEFAULT_HOST if args.host == '0.0.0.0' else args.host}:{args.port}"
        if port_busy(args.host, args.port):
            raise CliError(
                f"Порт {args.port} занят другим процессом. "
                f"Укажите другой: sfss start --port {args.port + 10}"
            )
        spawn_daemon(args.host, args.port, url)
        print(f"SFSS запущен: {url}")
    if args.with_llm:
        load_llm(url)
    with make_client(url) as client:
        print_health(client.get("/v1/health").json())
    return 0


def spawn_daemon(host: str, port: int, url: str) -> None:
    run_dir().mkdir(parents=True, exist_ok=True)
    with log_path().open("ab") as log:
        process = subprocess.Popen(
            [
                sys.executable, "-m", "uvicorn", "app.main:app",
                "--host", host, "--port", str(port), "--app-dir", str(BASE_DIR),
            ],
            cwd=BASE_DIR,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            # Отдельная сессия: демон переживает закрытие терминала
            start_new_session=True,
        )
    state_path().write_text(json.dumps({"pid": process.pid, "host": host, "port": port}))

    print("Прогрев моделей...", file=sys.stderr)
    deadline = time.monotonic() + START_TIMEOUT
    with make_client(url, read_timeout=5.0) as client:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                clear_state()
                details = "".join(tail(log_path(), 15))
                raise CliError(f"Демон завершился при старте. Конец лога:\n{details}")
            try:
                client.get("/v1/health")
                return
            except httpx.TransportError:
                time.sleep(0.5)
    raise CliError(f"Демон не ответил за {START_TIMEOUT:.0f} с. Лог: sfss logs")


def load_llm(url: str) -> None:
    """Загружает модель заранее и с нужным контекстом."""
    print("Загружаю модель...", file=sys.stderr)
    with make_client(url, read_timeout=LOAD_TIMEOUT) as client:
        response = client.post("/v1/llm/load")
        raise_for_detail(response)


def cmd_unload(args: argparse.Namespace) -> int:
    url = base_url(args)
    with make_client(url, read_timeout=LOAD_TIMEOUT) as client:
        raise_for_detail(client.post("/v1/llm/unload"))
        print(f"Модель     {describe_model(client.get('/v1/health').json())}")
    return 0


def cmd_load(args: argparse.Namespace) -> int:
    url = base_url(args)
    load_llm(url)
    with make_client(url) as client:
        print(f"Модель     {describe_model(client.get('/v1/health').json())}")
    return 0


def cmd_stop(_: argparse.Namespace) -> int:
    state = read_state()
    if not state:
        print("SFSS не запущен")
        return 0
    pid = state["pid"]
    if not is_ours(pid):
        # Запись устарела: демон упал или машину перезагружали
        clear_state()
        print("SFSS не запущен")
        return 0
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + STOP_TIMEOUT
    while time.monotonic() < deadline and is_ours(pid):
        time.sleep(0.2)
    if is_ours(pid):
        os.kill(pid, signal.SIGKILL)
    clear_state()
    print("SFSS остановлен")
    return 0


def print_health(health: dict) -> None:
    documents = health.get("indexed_documents")
    print(f"Индекс     {'ok, ' + str(documents) + ' фрагментов' if health['chroma'] else 'недоступен'}")
    runtime = health.get("runtime_name", "LM Studio")
    address = health.get("runtime_address")
    state = f"ok, {address}" if health["lm_studio"] and address else "ok"
    if not health["lm_studio"]:
        state = f"не отвечает{' на ' + address if address else ''}: вопросы к AI работать не будут"
    print(f"{runtime:<10} {state}")
    print(f"Модель     {describe_model(health)}")


def describe_model(health: dict) -> str:
    name = health["model"]
    loaded = health.get("model_loaded")
    if loaded is None:
        return name
    if not loaded:
        return f"{name}, не загружена: sfss load"
    context = health.get("model_context_length")
    limit = health.get("model_context_limit")
    if context and limit and context > limit:
        return f"{name}, контекст {context}: на 8 ГБ это своп, нужен {limit}"
    return f"{name}, загружена, контекст {context}" if context else f"{name}, загружена"


def cmd_status(args: argparse.Namespace) -> int:
    url = base_url(args)
    with make_client(url) as client:
        health = client.get("/v1/health").json()
    if args.json:
        print(json.dumps(health, ensure_ascii=False))
        return 0
    state = read_state()
    pid = f", pid {state['pid']}" if state and is_ours(state["pid"]) else ""
    print(f"SFSS       работает, {url}{pid}")
    print_health(health)
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    path = log_path()
    if not path.exists():
        raise CliError("Лога ещё нет: демон не запускался")
    sys.stdout.writelines(tail(path, args.lines))
    if not args.follow:
        return 0
    with path.open(errors="replace") as file:
        file.seek(0, os.SEEK_END)
        try:
            while True:
                line = file.readline()
                if line:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                else:
                    time.sleep(0.3)
        except KeyboardInterrupt:
            return 0


# --- config -------------------------------------------------------------------


def config_request(args: argparse.Namespace, method: str, body: dict | None = None) -> dict | None:
    """Настройки через демон: он применит их сразу.

    None — демон выключен, а адрес не задан явно: тогда правим файл, и настройка
    сработает при следующем sfss start. Нельзя только посмотреть список моделей.
    """
    try:
        with make_client(base_url(args), read_timeout=LOAD_TIMEOUT) as client:
            response = client.request(method, "/v1/llm/config", json=body)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        if getattr(args, "url", None) or os.environ.get("SFSS_URL"):
            raise
        return None
    raise_for_detail(response)
    return response.json()


def print_config(config: dict) -> None:
    runtime = config["runtime"]
    state = {True: ", отвечает", False: ", не отвечает"}.get(runtime.get("reachable"), "")
    print(f"Рантайм    {runtime['name']}, {runtime['host']}:{runtime['port']}{state}")
    model = config["model"]
    missing = ", нет у рантайма: sfss config models" if model.get("available") is False else ""
    print(f"Модель     {model['name']}{missing}")
    if runtime.get("controls_context", True):
        print(f"Контекст   {model['context_length']}")
    else:
        print(f"Контекст   задаётся в {runtime['name']}: OLLAMA_CONTEXT_LENGTH")
    print(f"Ответ до   {model['max_tokens']} токенов")
    if config.get("embedding_model"):
        print(f"Эмбеддинги {config['embedding_model']} (смена только в .env и с новой индексацией)")


def file_config_view() -> dict:
    """Настройки с диска в том же виде, что отвечает API, но без проверки рантайма."""
    settings = get_settings()
    config = load_config(settings)
    runtime = make_runtime(config.runtime, settings.llm_load_timeout)
    return {
        "runtime": {**config.runtime.model_dump(), "name": runtime.name, "controls_context": runtime.controls_context},
        "model": config.model.model_dump(),
        "embedding_model": settings.embedding_model,
    }


def change_config(args: argparse.Namespace, patch: LLMConfigPatch) -> int:
    answer = config_request(args, "PATCH", patch.model_dump(exclude_none=True))
    if answer is None:
        settings = get_settings()
        try:
            save_config(settings, apply_patch(load_config(settings), patch))
        except ConfigError as exc:
            raise CliError(str(exc)) from exc
        print("SFSS не запущен: сохранено, сработает при sfss start")
        answer = file_config_view()
    print_config(answer)
    return 0


def cmd_config(args: argparse.Namespace) -> int:
    answer = config_request(args, "GET")
    if answer is None:
        print("SFSS не запущен: показаны сохранённые настройки")
        answer = file_config_view()
    print(json.dumps(answer, ensure_ascii=False)) if args.json else print_config(answer)
    return 0


def cmd_config_runtime(args: argparse.Namespace) -> int:
    if args.kind is None and args.host is None and args.port is None:
        raise CliError("Укажите, что менять: sfss config runtime ollama --port 11434")
    return change_config(args, LLMConfigPatch(runtime=RuntimePatch(kind=args.kind, host=args.host, port=args.port)))


def cmd_config_model(args: argparse.Namespace) -> int:
    if args.name is None and args.context is None and args.max_tokens is None:
        raise CliError("Укажите, что менять: sfss config model ИМЯ --context 8192. Список: sfss config models")
    patch = ModelPatch(name=args.name, context_length=args.context, max_tokens=args.max_tokens)
    return change_config(args, LLMConfigPatch(model=patch))


def cmd_config_models(args: argparse.Namespace) -> int:
    with make_client(base_url(args)) as client:
        response = client.get("/v1/llm/models")
        raise_for_detail(response)
        current = client.get("/v1/health").json()["model"]
    models = response.json()["models"]
    if not models:
        print("У рантайма нет доступных моделей")
    for model in models:
        marks = [mark for mark, on in (("выбрана", model["id"] == current), ("загружена", model["loaded"])) if on]
        print(f"{model['id']}{'  (' + ', '.join(marks) + ')' if marks else ''}")
    return 0


def cmd_config_reset(args: argparse.Namespace) -> int:
    answer = config_request(args, "DELETE")
    if answer is None:
        forget_config(get_settings())
        print("SFSS не запущен: настройки сброшены")
        answer = file_config_view()
    print_config(answer)
    return 0


# --- predict ------------------------------------------------------------------


def fraction(name: str, value: float | None) -> None:
    if value is not None and not 0 <= value <= 1:
        raise CliError(f"--{name} это доля от 0 до 1, например 0.30, а не {value}")


def atmosphere_params(args: argparse.Namespace) -> dict:
    """Аргументы команды → parameters для /predict.

    Азот досчитывается до единицы. Демон подставил бы воздушные 0.79 и при 30%
    кислорода посчитал бы смесь на 109%: число выйдет правдоподобным, но неверным.
    """
    for name, value in (("o2", args.o2), ("n2", args.n2), ("co2", args.co2), ("he", args.he)):
        fraction(name, value)

    params: dict = {}
    if args.pressure is not None:
        params["pressure_mmhg"] = args.pressure
    elif args.psi is not None:
        params["pressure_mmhg"] = round(args.psi * PSI_TO_MMHG, 1)
    if args.o2 is not None:
        params["oxygen_level"] = args.o2
    if args.co2 is not None:
        params["co2"] = args.co2
    if args.he is not None:
        params["he"] = args.he
    if args.n2 is not None:
        params["n2"] = args.n2
    elif args.o2 is not None or args.co2 is not None or args.he is not None:
        oxygen = AIR["oxygen_level"] if args.o2 is None else args.o2
        rest = round(1 - oxygen - (args.co2 or 0.0) - (args.he or 0.0), 4)
        if rest < 0:
            raise CliError("Сумма долей газов больше единицы")
        params["n2"] = rest
    if args.droplet is not None:
        params["d_initial_mm"] = args.droplet
    if args.fuel is not None:
        params["fuel_methanol"] = 1.0 if args.fuel == "methanol" else 0.0
        params["fuel_heptane"] = 1.0 if args.fuel == "heptane" else 0.0
    return params


def post_predict(client: httpx.Client, params: dict) -> dict:
    response = client.post("/v1/predict", json={"parameters": params})
    raise_for_detail(response)
    return response.json()


def cmd_predict(args: argparse.Namespace) -> int:
    if args.csv:
        return predict_csv(args)
    params = atmosphere_params(args)
    with make_client(base_url(args)) as client:
        result = post_predict(client, params)
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
            return 0
        value = result.get("predicted_value")
        if value is None:
            print(f"Оценка риска  {result['risk_score']:.3f}")
        else:
            print(f"Скорость горения  {value:.3f} мм²/с")
            # Сравниваем с воздухом при том же топливе и той же капле
            air = {k: v for k, v in params.items() if k in ("d_initial_mm", "fuel_methanol", "fuel_heptane")}
            baseline = post_predict(client, AIR | air).get("predicted_value")
            if baseline:
                print(f"От обычного воздуха  ×{value / baseline:.2f}")
    if result.get("is_heuristic"):
        print("Это оценка эвристикой, а не предсказание обученной модели")
    for warning in result.get("warnings", []):
        print(f"Внимание: {warning}")
    if result.get("defaults_applied"):
        print("По умолчанию: " + ", ".join(result["defaults_applied"]))
    return 0


def predict_csv(args: argparse.Namespace) -> int:
    """Пакет из CSV: к входным колонкам дописываются результаты."""
    conflict = [
        name for name in ("o2", "pressure", "psi", "n2", "co2", "he", "droplet", "fuel")
        if getattr(args, name) is not None
    ]
    if conflict:
        raise CliError("--csv нельзя совмещать с условиями в аргументах: " + ", ".join(conflict))
    try:
        text = Path(args.csv).read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise CliError(f"Не прочитать {args.csv}: {exc}") from exc

    with make_client(base_url(args), read_timeout=120.0) as client:
        response = client.post(
            "/v1/predict/batch", content=text.encode(), headers={"Content-Type": "text/csv"}
        )
    raise_for_detail(response)
    result = response.json()
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
        return 0

    table = merge_results(text, result["rows"])
    if args.out:
        Path(args.out).write_text(table, encoding="utf-8")
        print(f"Записано: {args.out}")
    else:
        sys.stdout.write(table)
    print(f"Строк: {result['total']}, с ошибкой: {result['failed']}", file=sys.stderr)
    return EXIT_ERROR if result["failed"] else 0


def merge_results(text: str, rows: list[dict]) -> str:
    source = list(csv.DictReader(io.StringIO(text)))
    fields = list(csv.DictReader(io.StringIO(text)).fieldnames or [])
    output = io.StringIO()
    writer = csv.DictWriter(
        output, [*fields, "predicted_value", "warnings", "error"],
        extrasaction="ignore", lineterminator="\n",
    )
    writer.writeheader()
    for record, row in zip(source, rows):
        writer.writerow(record | {
            "predicted_value": row.get("predicted_value"),
            "warnings": "; ".join(row.get("warnings") or []),
            "error": row.get("error") or "",
        })
    return output.getvalue()


# --- import -------------------------------------------------------------------


def cmd_import(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.is_file():
        raise CliError(f"Нет файла: {path}")
    print("Индексирую, большой отчёт займёт минуты...", file=sys.stderr)
    with make_client(base_url(args), read_timeout=IMPORT_TIMEOUT) as client, path.open("rb") as file:
        response = client.post(
            "/v1/documents", files={"file": (path.name, file, "application/pdf")}
        )
    raise_for_detail(response)
    document = response.json()
    print(f"Добавлен {document['doc_id']}: {document['chunks']} фрагментов")
    return 0


# --- ask ----------------------------------------------------------------------


STAGES = {
    "loading": "Загружаю модель...",
    "searching": "Ищу в отчётах...",
    "answering": "Модель пишет ответ...",
    "translating": "Перевожу...",
}


def detect_language(question: str) -> str:
    return "ru" if any("а" <= ch <= "я" or ch == "ё" for ch in question.lower()) else "en"


def cmd_ask(args: argparse.Namespace) -> int:
    payload = {"question": args.question, "language": args.lang or detect_language(args.question)}
    print("Ищу в отчётах...", file=sys.stderr)
    sources: list[dict] = []
    with make_client(base_url(args), read_timeout=ASK_SILENCE_TIMEOUT) as client:
        with client.stream("POST", "/v1/query/stream", json=payload) as response:
            if response.is_error:
                response.read()
                raise_for_detail(response)
            for line in response.iter_lines():
                if not line.strip():
                    continue
                event = json.loads(line)
                kind = event["type"]
                if kind == "sources":
                    sources = event["sources"]
                elif kind == "stage":
                    print(STAGES.get(event["stage"], event["stage"]), file=sys.stderr)
                elif kind == "delta":
                    print(event["text"], end="", flush=True)
                elif kind == "error":
                    print()
                    raise CliError(event["detail"])
    print()
    for number, source in enumerate(sources, start=1):
        page = f", стр. {source['page']}" if source.get("page") is not None else ""
        print(f"[{number}] {source['doc_id']}{page}")
    return 0


# --- playground ---------------------------------------------------------------


def cmd_playground(args: argparse.Namespace) -> int:
    """Площадка в браузере: без проверки адрес откроется и при выключенном демоне."""
    url = base_url(args)
    with make_client(url) as client:
        client.get("/v1/health")
    target = f"{url}/playground"
    print(target)
    if not args.no_open:
        webbrowser.open(target)
    return 0


# --- Разбор аргументов --------------------------------------------------------


def raise_for_detail(response: httpx.Response) -> None:
    if not response.is_error:
        return
    try:
        detail = response.json().get("detail", response.text)
    except ValueError:
        detail = response.text
    raise CliError(f"Ошибка {response.status_code}: {detail}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sfss",
        description="Space Fire Security Software: горение в невесомости по данным NASA",
    )
    commands = parser.add_subparsers(dest="command", metavar="команда")

    def command(name: str, handler, description: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=description, description=description)
        sub.set_defaults(handler=handler)
        return sub

    start = command("start", cmd_start, "Запустить демон в фоне")
    start.add_argument("--host", default=DEFAULT_HOST, help="адрес, который слушать")
    start.add_argument("--port", type=int, default=DEFAULT_PORT, help="порт")
    start.add_argument("--with-llm", action="store_true", help="сразу загрузить модель в память")

    command("stop", cmd_stop, "Остановить демон")

    load = command("load", cmd_load, "Загрузить модель в память с контекстом из настроек")
    load.add_argument("--url", help="адрес демона")

    unload = command("unload", cmd_unload, "Выгрузить модель из памяти")
    unload.add_argument("--url", help="адрес демона")

    config = command("config", cmd_config, "Настройки нейросети: рантайм и модель")
    config.add_argument("--url", help="адрес демона")
    config.add_argument("--json", action="store_true", help="ответ как есть, для скриптов")
    config_commands = config.add_subparsers(dest="config_command", metavar="что")

    def config_command(name: str, handler, description: str) -> argparse.ArgumentParser:
        sub = config_commands.add_parser(name, help=description, description=description)
        sub.set_defaults(handler=handler)
        # SUPPRESS: иначе пустое значение здесь затёрло бы --url, заданный до подкоманды
        sub.add_argument("--url", default=argparse.SUPPRESS, help="адрес демона")
        return sub

    runtime = config_command("runtime", cmd_config_runtime, "Где работает нейросеть: LM Studio или Ollama, адрес и порт")
    runtime.add_argument("kind", nargs="?", choices=sorted(DEFAULT_PORTS), help="рантайм; порт станет его стандартным")
    runtime.add_argument("--host", help="адрес, по умолчанию localhost")
    runtime.add_argument("--port", type=int, help="порт: LM Studio 1234, Ollama 11434")

    model = config_command("model", cmd_config_model, "Какая модель отвечает на вопросы")
    model.add_argument("name", nargs="?", help="имя модели у рантайма: sfss config models")
    model.add_argument("--context", type=int, help="длина контекста при загрузке; только LM Studio")
    model.add_argument("--max-tokens", type=int, help="потолок длины ответа")

    config_command("models", cmd_config_models, "Какие модели есть у рантайма")
    config_command("reset", cmd_config_reset, "Вернуть значения из .env")

    status = command("status", cmd_status, "Состояние демона, индекса и модели")
    status.add_argument("--url", help="адрес демона")
    status.add_argument("--json", action="store_true", help="ответ как есть, для скриптов")

    logs = command("logs", cmd_logs, "Лог демона")
    logs.add_argument("-n", "--lines", type=int, default=50, help="сколько последних строк")
    logs.add_argument("-f", "--follow", action="store_true", help="следить за новыми строками")

    predict = command("predict", cmd_predict, "Скорость горения капли при заданной атмосфере")
    predict.add_argument("--o2", type=float, help="доля кислорода, например 0.30")
    pressure = predict.add_mutually_exclusive_group()
    pressure.add_argument("--pressure", type=float, help="давление, мм рт. ст.")
    pressure.add_argument("--psi", type=float, help="давление, psi")
    predict.add_argument("--n2", type=float, help="доля азота; без неё дополняет смесь до единицы")
    predict.add_argument("--co2", type=float, help="доля углекислого газа")
    predict.add_argument("--he", type=float, help="доля гелия")
    predict.add_argument("--droplet", type=float, help="начальный диаметр капли, мм")
    predict.add_argument("--fuel", choices=["methanol", "heptane"], help="топливо")
    predict.add_argument("--csv", help="посчитать все строки CSV; колонки как у /v1/predict")
    predict.add_argument("--out", help="куда записать таблицу результатов для --csv")
    predict.add_argument("--url", help="адрес демона")
    predict.add_argument("--json", action="store_true", help="ответ как есть, для скриптов")

    ask = command("ask", cmd_ask, "Вопрос по отчётам NASA, ответ со ссылками на страницы")
    ask.add_argument("question", help="вопрос")
    ask.add_argument("--lang", choices=["ru", "en"], help="язык ответа; по умолчанию язык вопроса")
    ask.add_argument("--url", help="адрес демона")

    import_command = command("import", cmd_import, "Добавить PDF в корпус документов")
    import_command.add_argument("file", help="PDF с текстовым слоем")
    import_command.add_argument("--url", help="адрес демона")

    playground = command("playground", cmd_playground, "Открыть Площадку в браузере")
    playground.add_argument("--url", help="адрес демона")
    playground.add_argument("--no-open", action="store_true", help="только напечатать адрес")

    def show_help(args: argparse.Namespace) -> int:
        target = commands.choices.get(args.topic) if args.topic else parser
        if target is None:
            raise CliError(f"Нет такой команды: {args.topic}")
        target.print_help()
        return 0

    help_command = command("help", show_help, "Справка по командам")
    help_command.add_argument("topic", nargs="?", help="команда")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0
    try:
        return args.handler(args)
    except CliError as exc:
        print(exc, file=sys.stderr)
        return exc.code
    except (httpx.ConnectError, httpx.ConnectTimeout):
        print(f"SFSS не отвечает на {base_url(args)}. Запустите: sfss start", file=sys.stderr)
        return EXIT_NOT_RUNNING
    except httpx.TimeoutException:
        print("Демон не ответил вовремя. Что с ним: sfss status, sfss logs", file=sys.stderr)
        return EXIT_ERROR
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
