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
START_TIMEOUT = 180.0
STOP_TIMEOUT = 15.0
ASK_SILENCE_TIMEOUT = 180.0
IMPORT_TIMEOUT = 900.0
LOAD_TIMEOUT = 200.0

PSI_TO_MMHG = 51.7149
AIR = {"pressure_mmhg": 760.0, "oxygen_level": 0.21, "n2": 0.79, "co2": 0.0, "he": 0.0}

EXIT_ERROR = 1
EXIT_NOT_RUNNING = 3


class CliError(Exception):
    def __init__(self, message: str, code: int = EXIT_ERROR) -> None:
        super().__init__(message)
        self.code = code


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


WINDOWS = sys.platform == "win32"


def process_command(pid: int) -> str | None:
    if WINDOWS:
        query = f'(Get-CimInstance Win32_Process -Filter "ProcessId={pid}").CommandLine'
        command = ["powershell", "-NoProfile", "-NonInteractive", "-Command", query]
    else:
        command = ["ps", "-p", str(pid), "-o", "command="]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = result.stdout.strip()
    return text if result.returncode == 0 and text else None


def is_ours(pid: int) -> bool:
    return "app.main:app" in (process_command(pid) or "")


CREATE_BREAKAWAY_FROM_JOB = 0x01000000


def detached(breakaway: bool = True) -> dict:
    if WINDOWS:
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        if breakaway:
            flags |= CREATE_BREAKAWAY_FROM_JOB
        return {"creationflags": flags}
    return {"start_new_session": True}


def base_url(args: argparse.Namespace) -> str:
    url = getattr(args, "url", None) or os.environ.get("SFSS_URL")
    if url:
        return url.rstrip("/")
    state = read_state() or {}
    host = state.get("host", DEFAULT_HOST)
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


def cmd_start(args: argparse.Namespace) -> int:
    state = read_state()
    if state and is_ours(state["pid"]):
        url = base_url(args)
        print(f"SFSS is already running: {url}, pid {state['pid']}")
    else:
        if not is_local_host(args.host) and not get_settings().sfss_api_key:
            raise CliError(
                f"Address {args.host} is reachable from the network, but there is no key: the API "
                "would refuse everyone outside. Set SFSS_API_KEY in .env"
            )
        url = f"http://{DEFAULT_HOST if args.host == '0.0.0.0' else args.host}:{args.port}"
        if port_busy(args.host, args.port):
            raise CliError(
                f"Port {args.port} is taken by another process. "
                f"Pick another one: sfss start --port {args.port + 10}"
            )
        spawn_daemon(args.host, args.port, url)
        print(f"SFSS started: {url}")
    if args.with_llm:
        load_llm(url)
    with make_client(url) as client:
        print_health(client.get("/v1/health").json())
    return 0


def spawn_daemon(host: str, port: int, url: str) -> None:
    run_dir().mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, "-m", "uvicorn", "app.main:app",
        "--host", host, "--port", str(port), "--app-dir", str(BASE_DIR),
    ]
    with log_path().open("ab") as log:
        options = dict(cwd=BASE_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        try:
            process = subprocess.Popen(command, **options, **detached())
        except PermissionError:
            process = subprocess.Popen(command, **options, **detached(breakaway=False))
    state_path().write_text(json.dumps({"pid": process.pid, "host": host, "port": port}))

    print("Warming up...", file=sys.stderr)
    deadline = time.monotonic() + START_TIMEOUT
    with make_client(url, read_timeout=5.0) as client:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                clear_state()
                details = "".join(tail(log_path(), 15))
                raise CliError(f"The daemon exited while starting. End of the log:\n{details}")
            try:
                client.get("/v1/health")
                return
            except httpx.TransportError:
                time.sleep(0.5)
    raise CliError(f"The daemon did not answer in {START_TIMEOUT:.0f} s. Log: sfss logs")


def load_llm(url: str) -> None:
    print("Loading the model...", file=sys.stderr)
    with make_client(url, read_timeout=LOAD_TIMEOUT) as client:
        response = client.post("/v1/llm/load")
        raise_for_detail(response)


def cmd_unload(args: argparse.Namespace) -> int:
    url = base_url(args)
    with make_client(url, read_timeout=LOAD_TIMEOUT) as client:
        raise_for_detail(client.post("/v1/llm/unload"))
        print(f"Model      {describe_model(client.get('/v1/health').json())}")
    return 0


def cmd_load(args: argparse.Namespace) -> int:
    url = base_url(args)
    load_llm(url)
    with make_client(url) as client:
        print(f"Model      {describe_model(client.get('/v1/health').json())}")
    return 0


def cmd_stop(_: argparse.Namespace) -> int:
    state = read_state()
    if not state:
        print("SFSS is not running")
        return 0
    pid = state["pid"]
    if not is_ours(pid):
        clear_state()
        print("SFSS is not running")
        return 0
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + STOP_TIMEOUT
    while time.monotonic() < deadline and is_ours(pid):
        time.sleep(0.2)
    if not WINDOWS and is_ours(pid):
        os.kill(pid, signal.SIGKILL)
    clear_state()
    print("SFSS stopped")
    return 0


def print_health(health: dict) -> None:
    documents = health.get("indexed_documents")
    print(f"Index      {'ok, ' + str(documents) + ' chunks' if health['chroma'] else 'unavailable'}")
    runtime = health.get("runtime_name", "LM Studio")
    address = health.get("runtime_address")
    state = f"ok, {address}" if health["lm_studio"] and address else "ok"
    if not health["lm_studio"]:
        state = f"not answering{' at ' + address if address else ''}: questions to the AI will not work"
    print(f"{runtime:<10} {state}")
    print(f"Model      {describe_model(health)}")


def describe_model(health: dict) -> str:
    name = health["model"]
    loaded = health.get("model_loaded")
    if loaded is None:
        return name
    if not loaded:
        return f"{name}, not loaded: sfss load"
    context = health.get("model_context_length")
    limit = health.get("model_context_limit")
    if context and limit and context > limit:
        return f"{name}, context {context}: on 8 GB this means swapping, use {limit}"
    return f"{name}, loaded, context {context}" if context else f"{name}, loaded"


def cmd_status(args: argparse.Namespace) -> int:
    url = base_url(args)
    with make_client(url) as client:
        health = client.get("/v1/health").json()
    if args.json:
        print(json.dumps(health, ensure_ascii=False))
        return 0
    state = read_state()
    pid = f", pid {state['pid']}" if state and is_ours(state["pid"]) else ""
    print(f"SFSS       running, {url}{pid}")
    print_health(health)
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    path = log_path()
    if not path.exists():
        raise CliError("No log yet: the daemon has not been started")
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


def config_request(args: argparse.Namespace, method: str, body: dict | None = None) -> dict | None:
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
    state = {True: ", answering", False: ", not answering"}.get(runtime.get("reachable"), "")
    print(f"Runtime    {runtime['name']}, {runtime['host']}:{runtime['port']}{state}")
    model = config["model"]
    missing = ", not in the runtime: sfss config models" if model.get("available") is False else ""
    print(f"Model      {model['name']}{missing}")
    if runtime.get("controls_context", True):
        print(f"Context    {model['context_length']}")
    else:
        print(f"Context    set in {runtime['name']}: OLLAMA_CONTEXT_LENGTH")
    print(f"Answer     up to {model['max_tokens']} tokens")
    if config.get("embedding_model"):
        print(f"Search     {config['embedding_model']} (changed only in .env, with a new index)")


def file_config_view() -> dict:
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
        print("SFSS is not running: saved, takes effect on sfss start")
        answer = file_config_view()
    print_config(answer)
    return 0


def cmd_config(args: argparse.Namespace) -> int:
    answer = config_request(args, "GET")
    if answer is None:
        print("SFSS is not running: showing the saved settings")
        answer = file_config_view()
    print(json.dumps(answer, ensure_ascii=False)) if args.json else print_config(answer)
    return 0


def cmd_config_runtime(args: argparse.Namespace) -> int:
    if args.kind is None and args.host is None and args.port is None:
        raise CliError("Say what to change: sfss config runtime ollama --port 11434")
    return change_config(args, LLMConfigPatch(runtime=RuntimePatch(kind=args.kind, host=args.host, port=args.port)))


def cmd_config_model(args: argparse.Namespace) -> int:
    if args.name is None and args.context is None and args.max_tokens is None:
        raise CliError("Say what to change: sfss config model NAME --context 8192. List: sfss config models")
    patch = ModelPatch(name=args.name, context_length=args.context, max_tokens=args.max_tokens)
    return change_config(args, LLMConfigPatch(model=patch))


def cmd_config_models(args: argparse.Namespace) -> int:
    with make_client(base_url(args)) as client:
        response = client.get("/v1/llm/models")
        raise_for_detail(response)
        current = client.get("/v1/health").json()["model"]
    models = response.json()["models"]
    if not models:
        print("The runtime has no models available")
    for model in models:
        selected = model.get("selected", model["id"] == current)
        marks = [mark for mark, on in (("selected", selected), ("loaded", model["loaded"])) if on]
        print(f"{model['id']}{'  (' + ', '.join(marks) + ')' if marks else ''}")
    return 0


def cmd_config_reset(args: argparse.Namespace) -> int:
    answer = config_request(args, "DELETE")
    if answer is None:
        forget_config(get_settings())
        print("SFSS is not running: settings reset")
        answer = file_config_view()
    print_config(answer)
    return 0


def fraction(name: str, value: float | None) -> None:
    if value is not None and not 0 <= value <= 1:
        raise CliError(f"--{name} is a fraction from 0 to 1, for example 0.30, not {value}")


def atmosphere_params(args: argparse.Namespace) -> dict:
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
            raise CliError("The gas fractions add up to more than 1")
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
            print(f"Risk score  {result['risk_score']:.3f}")
        else:
            print(f"Burning rate  {value:.3f} mm²/s")
            air = {k: v for k, v in params.items() if k in ("d_initial_mm", "fuel_methanol", "fuel_heptane")}
            baseline = post_predict(client, AIR | air).get("predicted_value")
            if baseline:
                print(f"Versus normal air  ×{value / baseline:.2f}")
    if result.get("is_heuristic"):
        print("This is a heuristic estimate, not a prediction of the trained model")
    for warning in result.get("warnings", []):
        print(f"Warning: {warning}")
    if result.get("defaults_applied"):
        print("Defaults used: " + ", ".join(result["defaults_applied"]))
    return 0


def predict_csv(args: argparse.Namespace) -> int:
    conflict = [
        name for name in ("o2", "pressure", "psi", "n2", "co2", "he", "droplet", "fuel")
        if getattr(args, name) is not None
    ]
    if conflict:
        raise CliError("--csv cannot be combined with conditions in arguments: " + ", ".join(conflict))
    try:
        text = Path(args.csv).read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        raise CliError(f"Cannot read {args.csv}: {exc}") from exc

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
        print(f"Written: {args.out}")
    else:
        sys.stdout.write(table)
    print(f"Rows: {result['total']}, with errors: {result['failed']}", file=sys.stderr)
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


def cmd_import(args: argparse.Namespace) -> int:
    path = Path(args.file)
    if not path.is_file():
        raise CliError(f"No such file: {path}")
    print("Indexing, a large report takes minutes...", file=sys.stderr)
    with make_client(base_url(args), read_timeout=IMPORT_TIMEOUT) as client, path.open("rb") as file:
        response = client.post(
            "/v1/documents", files={"file": (path.name, file, "application/pdf")}
        )
    raise_for_detail(response)
    document = response.json()
    print(f"Added {document['doc_id']}: {document['chunks']} chunks")
    return 0


STAGES = {
    "loading": "Loading the model...",
    "searching": "Searching the reports...",
    "answering": "Writing the answer...",
    "translating": "Translating...",
}


def detect_language(question: str) -> str:
    return "ru" if any("а" <= ch <= "я" or ch == "ё" for ch in question.lower()) else "en"


def cmd_ask(args: argparse.Namespace) -> int:
    payload = {"question": args.question, "language": args.lang or detect_language(args.question)}
    print("Searching the reports...", file=sys.stderr)
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
        page = f", p. {source['page']}" if source.get("page") is not None else ""
        print(f"[{number}] {source['doc_id']}{page}")
    return 0


def cmd_playground(args: argparse.Namespace) -> int:
    url = base_url(args)
    with make_client(url) as client:
        client.get("/v1/health")
    target = f"{url}/playground"
    print(target)
    if not args.no_open:
        webbrowser.open(target)
    return 0


def raise_for_detail(response: httpx.Response) -> None:
    if not response.is_error:
        return
    try:
        detail = response.json().get("detail", response.text)
    except ValueError:
        detail = response.text
    raise CliError(f"Error {response.status_code}: {detail}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sfss",
        description="Space Fire Security Software: combustion in microgravity from NASA data",
    )
    commands = parser.add_subparsers(dest="command", metavar="command")

    def command(name: str, handler, description: str) -> argparse.ArgumentParser:
        sub = commands.add_parser(name, help=description, description=description)
        sub.set_defaults(handler=handler)
        return sub

    start = command("start", cmd_start, "Start the daemon in the background")
    start.add_argument("--host", default=DEFAULT_HOST, help="address to listen on")
    start.add_argument("--port", type=int, default=DEFAULT_PORT, help="port")
    start.add_argument("--with-llm", action="store_true", help="load the language model right away")

    command("stop", cmd_stop, "Stop the daemon")

    load = command("load", cmd_load, "Load the language model with the configured context")
    load.add_argument("--url", help="daemon address")

    unload = command("unload", cmd_unload, "Unload the language model from memory")
    unload.add_argument("--url", help="daemon address")

    config = command("config", cmd_config, "Language model settings: runtime and model")
    config.add_argument("--url", help="daemon address")
    config.add_argument("--json", action="store_true", help="raw answer, for scripts")
    config_commands = config.add_subparsers(dest="config_command", metavar="setting")

    def config_command(name: str, handler, description: str) -> argparse.ArgumentParser:
        sub = config_commands.add_parser(name, help=description, description=description)
        sub.set_defaults(handler=handler)
        sub.add_argument("--url", default=argparse.SUPPRESS, help="daemon address")
        return sub

    runtime = config_command("runtime", cmd_config_runtime, "Where the model runs: LM Studio or Ollama, host and port")
    runtime.add_argument("kind", nargs="?", choices=sorted(DEFAULT_PORTS), help="runtime; the port becomes its default")
    runtime.add_argument("--host", help="host, localhost by default")
    runtime.add_argument("--port", type=int, help="port: LM Studio 1234, Ollama 11434")

    model = config_command("model", cmd_config_model, "Which model answers questions")
    model.add_argument("name", nargs="?", help="model name in the runtime: sfss config models")
    model.add_argument("--context", type=int, help="context length when loading; LM Studio only")
    model.add_argument("--max-tokens", type=int, help="answer length limit")

    config_command("models", cmd_config_models, "Models available in the runtime")
    config_command("reset", cmd_config_reset, "Go back to the values from .env")

    status = command("status", cmd_status, "State of the daemon, index and model")
    status.add_argument("--url", help="daemon address")
    status.add_argument("--json", action="store_true", help="raw answer, for scripts")

    logs = command("logs", cmd_logs, "Daemon log")
    logs.add_argument("-n", "--lines", type=int, default=50, help="how many last lines")
    logs.add_argument("-f", "--follow", action="store_true", help="follow new lines")

    predict = command("predict", cmd_predict, "Droplet burning rate in a given atmosphere")
    predict.add_argument("--o2", type=float, help="oxygen fraction, for example 0.30")
    pressure = predict.add_mutually_exclusive_group()
    pressure.add_argument("--pressure", type=float, help="pressure, mmHg")
    pressure.add_argument("--psi", type=float, help="pressure, psi")
    predict.add_argument("--n2", type=float, help="nitrogen fraction; without it nitrogen fills the rest of the mix")
    predict.add_argument("--co2", type=float, help="carbon dioxide fraction")
    predict.add_argument("--he", type=float, help="helium fraction")
    predict.add_argument("--droplet", type=float, help="initial droplet diameter, mm")
    predict.add_argument("--fuel", choices=["methanol", "heptane"], help="fuel")
    predict.add_argument("--csv", help="calculate every CSV row; columns as in /v1/predict")
    predict.add_argument("--out", help="where to write the results table for --csv")
    predict.add_argument("--url", help="daemon address")
    predict.add_argument("--json", action="store_true", help="raw answer, for scripts")

    ask = command("ask", cmd_ask, "Ask the NASA reports, answer with page references")
    ask.add_argument("question", help="the question")
    ask.add_argument("--lang", choices=["ru", "en"], help="answer language; the question language by default")
    ask.add_argument("--url", help="daemon address")

    import_command = command("import", cmd_import, "Add a PDF to the documents")
    import_command.add_argument("file", help="a PDF with a text layer")
    import_command.add_argument("--url", help="daemon address")

    playground = command("playground", cmd_playground, "Open the Playground in a browser")
    playground.add_argument("--url", help="daemon address")
    playground.add_argument("--no-open", action="store_true", help="only print the address")

    def show_help(args: argparse.Namespace) -> int:
        target = commands.choices.get(args.topic) if args.topic else parser
        if target is None:
            raise CliError(f"No such command: {args.topic}")
        target.print_help()
        return 0

    help_command = command("help", show_help, "Help on commands")
    help_command.add_argument("topic", nargs="?", help="a command")
    return parser


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if WINDOWS and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
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
        print(f"SFSS is not answering at {base_url(args)}. Start it: sfss start", file=sys.stderr)
        return EXIT_NOT_RUNNING
    except httpx.TimeoutException:
        print("The daemon did not answer in time. Check it: sfss status, sfss logs", file=sys.stderr)
        return EXIT_ERROR
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
