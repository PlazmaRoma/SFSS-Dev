"""Команда sfss: демон подменён, проверяется то, что делает сама команда."""

import json
import os
import socket

import httpx
import pytest

from app import cli
from app.config import Settings
from app.services.llm_service import LLMService


def parse(*argv: str):
    return cli.build_parser().parse_args(["predict", *argv])


@pytest.fixture
def run_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "run_dir", lambda: tmp_path)
    monkeypatch.delenv("SFSS_URL", raising=False)
    return tmp_path


def fake_daemon(monkeypatch, handler) -> None:
    def make_client(url, read_timeout=30.0):
        return httpx.Client(base_url=url, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(cli, "make_client", make_client)


# --- Параметры predict --------------------------------------------------------


def test_nitrogen_fills_the_mix_to_one():
    # Иначе демон подставит воздушные 0.79, и при 30% кислорода смесь выйдет на 109%
    assert parse("--o2", "0.30").o2 == 0.30
    assert cli.atmosphere_params(parse("--o2", "0.30"))["n2"] == 0.70
    assert cli.atmosphere_params(parse("--he", "0.40"))["n2"] == 0.39


def test_explicit_nitrogen_is_kept():
    assert cli.atmosphere_params(parse("--o2", "0.30", "--n2", "0.50"))["n2"] == 0.50


def test_nothing_set_sends_nothing():
    assert cli.atmosphere_params(parse()) == {}


def test_percent_instead_of_fraction_is_an_error():
    with pytest.raises(cli.CliError, match="0.30"):
        cli.atmosphere_params(parse("--o2", "30"))


def test_gases_over_one_is_an_error():
    with pytest.raises(cli.CliError, match="больше единицы"):
        cli.atmosphere_params(parse("--o2", "0.70", "--he", "0.50"))


def test_psi_becomes_mmhg():
    assert cli.atmosphere_params(parse("--psi", "14.7"))["pressure_mmhg"] == 760.2


def test_fuel_is_one_hot():
    params = cli.atmosphere_params(parse("--fuel", "heptane"))
    assert params["fuel_heptane"] == 1.0
    assert params["fuel_methanol"] == 0.0


def test_predict_compares_with_air_at_same_fuel_and_droplet(run_dir, monkeypatch, capsys):
    sent = []

    def handler(request):
        params = json.loads(request.content)["parameters"]
        sent.append(params)
        value = 0.6 if len(sent) == 1 else 0.5
        return httpx.Response(200, json={
            "risk_score": 0.5, "predicted_value": value, "defaults_applied": ["he"],
        })

    fake_daemon(monkeypatch, handler)
    assert cli.main(["predict", "--o2", "0.30", "--droplet", "2", "--fuel", "heptane"]) == 0

    assert sent[1]["oxygen_level"] == 0.21
    assert sent[1]["d_initial_mm"] == 2
    assert sent[1]["fuel_heptane"] == 1.0
    out = capsys.readouterr().out
    assert "0.600" in out
    assert "×1.20" in out
    assert "he" in out


def test_server_validation_error_is_shown(run_dir, monkeypatch, capsys):
    fake_daemon(monkeypatch, lambda _: httpx.Response(422, json={"detail": "Unknown parameters"}))
    assert cli.main(["predict"]) == cli.EXIT_ERROR
    assert "Unknown parameters" in capsys.readouterr().err


def test_predict_shows_warnings(run_dir, monkeypatch, capsys):
    fake_daemon(monkeypatch, lambda _: httpx.Response(200, json={
        "risk_score": 0.5, "predicted_value": 0.6, "warnings": ["oxygen_level=0.5 is outside"],
    }))
    assert cli.main(["predict", "--o2", "0.5"]) == 0
    assert "oxygen_level=0.5 is outside" in capsys.readouterr().out


def test_predict_goes_through_v1(run_dir, monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.url.path)
        return httpx.Response(200, json={"risk_score": 0.5})

    fake_daemon(monkeypatch, handler)
    assert cli.main(["predict"]) == 0
    assert seen == ["/v1/predict"]


# --- predict --csv ------------------------------------------------------------


def batch_answer(request):
    assert request.url.path == "/v1/predict/batch"
    assert request.headers["content-type"] == "text/csv"
    return httpx.Response(200, json={
        "total": 2,
        "failed": 1,
        "rows": [
            {"row": 1, "predicted_value": 0.6, "warnings": ["a", "b"]},
            {"row": 2, "error": "not a number"},
        ],
    })


def test_csv_results_are_added_to_input_columns(run_dir, monkeypatch, tmp_path):
    source = tmp_path / "runs.csv"
    source.write_text("oxygen_level,n2\n0.3,0.7\nabc,0.5\n")
    out = tmp_path / "out.csv"
    fake_daemon(monkeypatch, batch_answer)

    # Код 1: есть строка с ошибкой, скрипт должен это заметить
    assert cli.main(["predict", "--csv", str(source), "--out", str(out)]) == cli.EXIT_ERROR

    assert out.read_text().splitlines() == [
        "oxygen_level,n2,predicted_value,warnings,error",
        "0.3,0.7,0.6,a; b,",
        "abc,0.5,,,not a number",
    ]


def test_csv_cannot_be_mixed_with_conditions(run_dir, tmp_path):
    source = tmp_path / "runs.csv"
    source.write_text("oxygen_level\n0.3\n")
    assert cli.main(["predict", "--csv", str(source), "--o2", "0.3"]) == cli.EXIT_ERROR


def test_csv_missing_file(run_dir, capsys):
    assert cli.main(["predict", "--csv", "/no/such.csv"]) == cli.EXIT_ERROR
    assert "/no/such.csv" in capsys.readouterr().err


# --- import -------------------------------------------------------------------


def test_import_uploads_file(run_dir, monkeypatch, tmp_path, capsys):
    source = tmp_path / "report.pdf"
    source.write_bytes(b"%PDF-1.4 test")
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["body"] = request.read()
        return httpx.Response(201, json={"doc_id": "report", "chunks": 7})

    fake_daemon(monkeypatch, handler)
    assert cli.main(["import", str(source)]) == 0
    assert seen["path"] == "/v1/documents"
    assert b"%PDF-1.4 test" in seen["body"]
    assert "7" in capsys.readouterr().out


def test_import_missing_file(run_dir, capsys):
    assert cli.main(["import", "/no/such.pdf"]) == cli.EXIT_ERROR


def test_import_shows_server_reason(run_dir, monkeypatch, tmp_path, capsys):
    source = tmp_path / "scan.pdf"
    source.write_bytes(b"%PDF-")
    fake_daemon(monkeypatch, lambda _: httpx.Response(422, json={"detail": "No text layer"}))
    assert cli.main(["import", str(source)]) == cli.EXIT_ERROR
    assert "No text layer" in capsys.readouterr().err


# --- ask ----------------------------------------------------------------------


def stream(*events) -> httpx.Response:
    body = "".join(json.dumps(event) + "\n" for event in events)
    return httpx.Response(200, text=body)


def test_ask_prints_stream_and_sources(run_dir, monkeypatch, capsys):
    sent = {}

    def handler(request):
        sent.update(json.loads(request.content))
        return stream(
            {"type": "sources", "sources": [{"doc_id": "NTRS-1", "excerpt": "x", "page": 4}], "search_query": None},
            {"type": "stage", "stage": "answering"},
            {"type": "delta", "text": "Пламя "},
            {"type": "delta", "text": "гаснет."},
            {"type": "done", "answer": "Пламя гаснет."},
        )

    fake_daemon(monkeypatch, handler)
    assert cli.main(["ask", "Почему гаснет пламя?"]) == 0

    assert sent["language"] == "ru"
    out = capsys.readouterr().out
    assert "Пламя гаснет." in out
    assert "[1] NTRS-1, стр. 4" in out


def test_ask_language_follows_the_question():
    assert cli.detect_language("Why does it burn?") == "en"
    assert cli.detect_language("Что такое BASS-II?") == "ru"


def test_ask_reports_error_in_the_middle_of_stream(run_dir, monkeypatch, capsys):
    fake_daemon(monkeypatch, lambda _: stream(
        {"type": "delta", "text": "Начало"},
        {"type": "error", "detail": "LM Studio is unreachable"},
    ))
    assert cli.main(["ask", "Why?"]) == cli.EXIT_ERROR
    assert "LM Studio is unreachable" in capsys.readouterr().err


# --- Демон не запущен ---------------------------------------------------------


def test_daemon_not_running_tells_what_to_do(run_dir, monkeypatch, capsys):
    def refuse(_):
        raise httpx.ConnectError("refused")

    fake_daemon(monkeypatch, refuse)
    assert cli.main(["status"]) == cli.EXIT_NOT_RUNNING
    assert "sfss start" in capsys.readouterr().err


# --- Адрес, pid и порт --------------------------------------------------------


def test_url_comes_from_start_state(run_dir, monkeypatch):
    cli.state_path().write_text(json.dumps({"pid": 1, "host": "0.0.0.0", "port": 8010}))
    args = cli.build_parser().parse_args(["status"])
    # 0.0.0.0 слушают, но подключаться к нему нельзя
    assert cli.base_url(args) == "http://127.0.0.1:8010"

    monkeypatch.setenv("SFSS_URL", "http://station:9000/")
    assert cli.base_url(args) == "http://station:9000"


def test_foreign_process_is_not_ours():
    # pytest жив, но это не наш uvicorn
    assert cli.is_ours(os.getpid()) is False


def test_stop_does_not_kill_a_reused_pid(run_dir, capsys):
    # После перезагрузки номер из файла мог достаться чужому процессу
    cli.state_path().write_text(json.dumps({"pid": os.getpid(), "host": "127.0.0.1", "port": 8000}))
    assert cli.main(["stop"]) == 0
    assert not cli.state_path().exists()
    assert "не запущен" in capsys.readouterr().out


def test_start_refuses_a_busy_port(run_dir, capsys):
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        assert cli.main(["start", "--port", str(port)]) == cli.EXIT_ERROR
    assert "занят" in capsys.readouterr().err
    assert not cli.state_path().exists()


def test_network_host_requires_a_key(run_dir, monkeypatch, capsys):
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(sfss_api_key=None, run_dir=run_dir))
    assert cli.main(["start", "--host", "0.0.0.0", "--port", "1"]) == cli.EXIT_ERROR
    assert "SFSS_API_KEY" in capsys.readouterr().err
    assert not cli.state_path().exists()


def test_key_goes_into_requests(monkeypatch):
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(sfss_api_key="secret"))
    with cli.make_client("http://x") as client:
        assert client.headers["x-api-key"] == "secret"


def test_playground_opens_in_browser(run_dir, monkeypatch, capsys):
    opened = []
    monkeypatch.setattr(cli.webbrowser, "open", opened.append)
    fake_daemon(monkeypatch, lambda _: httpx.Response(200, json={}))
    assert cli.main(["playground", "--url", "http://x:1"]) == 0
    assert opened == ["http://x:1/playground"]


def test_playground_tells_when_daemon_is_down(run_dir, monkeypatch, capsys):
    opened = []
    monkeypatch.setattr(cli.webbrowser, "open", opened.append)

    def refuse(_):
        raise httpx.ConnectError("refused")

    fake_daemon(monkeypatch, refuse)
    assert cli.main(["playground"]) == cli.EXIT_NOT_RUNNING
    assert opened == []
    assert "sfss start" in capsys.readouterr().err


def test_help_for_one_command(capsys):
    assert cli.main(["help", "predict"]) == 0
    assert "--o2" in capsys.readouterr().out


def test_help_for_unknown_command(capsys):
    assert cli.main(["help", "nope"]) == cli.EXIT_ERROR


# --- Состояние модели в LM Studio ---------------------------------------------


def lm_studio_answers(monkeypatch, data=None, error=False):
    def get(url, timeout):
        assert url == "http://localhost:1234/api/v0/models"
        if error:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json={"data": data}, request=httpx.Request("GET", url))

    monkeypatch.setattr("app.services.llm_runtime.httpx.get", get)


def test_model_state_loaded(monkeypatch):
    llm = LLMService()
    lm_studio_answers(monkeypatch, [
        {"id": "other", "state": "not-loaded"},
        {"id": llm.settings.lm_studio_model, "state": "loaded", "loaded_context_length": 8192},
    ])
    assert llm.model_state() == (True, 8192)


def test_model_state_not_loaded(monkeypatch):
    llm = LLMService()
    lm_studio_answers(monkeypatch, [{"id": llm.settings.lm_studio_model, "state": "not-loaded"}])
    assert llm.model_state() == (False, None)


def test_model_state_unknown_on_other_servers(monkeypatch):
    lm_studio_answers(monkeypatch, error=True)
    assert LLMService().model_state() == (None, None)


def test_describe_model_warns_about_huge_context():
    health = {"model": "m", "model_loaded": True, "model_context_length": 262144, "model_context_limit": 8192}
    assert "своп" in cli.describe_model(health)
    health = {"model": "m", "model_loaded": False}
    assert "sfss load" in cli.describe_model(health)
