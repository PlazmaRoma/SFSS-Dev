"""Настройки нейросети: рантайм и модель отдельно, LM Studio и Ollama."""

import json
import subprocess
from types import SimpleNamespace

import httpx
import pytest

from app import cli
from app.config import Settings, get_settings
from app.dependencies import get_llm_service
from app.main import app
from app.services import llm_runtime
from app.services.llm_config import (
    ConfigError,
    LLMConfig,
    LLMConfigPatch,
    ModelConfig,
    ModelPatch,
    RuntimeConfig,
    RuntimePatch,
    apply_patch,
    default_config,
    load_config,
)
from app.services.llm_runtime import LMStudioRuntime, ModelLoadError, OllamaRuntime
from app.services.llm_service import LLMService, ModelBusyError, _load_lock


def answer(payload, status=200):
    request = httpx.Request("GET", "http://test")
    return httpx.Response(status, json=payload, request=request)


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, llm_config_path=tmp_path / "llm.json")


BASE = LLMConfig(runtime=RuntimeConfig(), model=ModelConfig(name="ministral"))


def patch_runtime(**fields):
    return LLMConfigPatch(runtime=RuntimePatch(**fields))


def patch_model(**fields):
    return LLMConfigPatch(model=ModelPatch(**fields))


# --- Проверка значений --------------------------------------------------------


def test_defaults_come_from_env_values():
    config = default_config(Settings(_env_file=None, lm_studio_base_url="http://10.0.0.5:1235/v1"))
    assert (config.runtime.kind, config.runtime.host, config.runtime.port) == ("lmstudio", "10.0.0.5", 1235)


def test_changing_runtime_takes_its_port():
    assert apply_patch(BASE, patch_runtime(kind="ollama")).runtime.port == 11434


def test_explicit_port_wins():
    assert apply_patch(BASE, patch_runtime(kind="ollama", port=11500)).runtime.port == 11500


def test_runtime_and_model_change_separately():
    config = apply_patch(BASE, patch_runtime(port=1235))
    assert config.model == BASE.model
    config = apply_patch(BASE, patch_model(max_tokens=256))
    assert config.runtime == BASE.runtime
    assert config.model.name == "ministral"


@pytest.mark.parametrize("patch", [
    patch_runtime(port=0),
    patch_runtime(port=70000),
    patch_runtime(host="http://localhost"),
    patch_runtime(host="a b"),
    patch_model(name="--yes"),
    patch_model(name="a b"),
    patch_model(context_length=10),
    patch_model(max_tokens=9000),
])
def test_bad_values_are_refused(patch):
    with pytest.raises(ConfigError):
        apply_patch(BASE, patch)


@pytest.mark.parametrize("name", ["qwen3-4b-instruct-2507", "Qwen2.5-coder", "deepseek-r1:8b", "glm-4", "yi-34b", "bge-m3"])
def test_banned_models_are_refused(name):
    with pytest.raises(ConfigError, match="banned"):
        apply_patch(BASE, patch_model(name=name))


@pytest.mark.parametrize("name", ["ministral-3-3b-instruct-2512", "google/gemma-3-1b", "ministral-3:3b"])
def test_allowed_models_pass(name):
    assert apply_patch(BASE, patch_model(name=name)).model.name == name


# --- Хранение ------------------------------------------------------------------


def test_saved_config_survives_restart(settings):
    llm = LLMService(settings)
    llm.runtime.state = lambda _: (False, None)
    llm.update_config(patch_runtime(port=1235))
    assert LLMService(settings).config.runtime.port == 1235


def test_broken_file_falls_back_to_defaults(settings):
    settings.llm_config_path.write_text("{not json")
    assert load_config(settings) == default_config(settings)


def test_reset_returns_to_defaults(settings):
    llm = LLMService(settings)
    llm.runtime.state = lambda _: (False, None)
    llm.update_config(patch_runtime(port=1235))
    llm.runtime.state = lambda _: (False, None)
    assert llm.reset_config() == default_config(settings)
    assert not settings.llm_config_path.exists()


# --- Переключение на ходу ------------------------------------------------------


def stub_runtime(llm, loaded=True):
    calls = []
    llm.runtime.state = lambda model: (loaded, 8192 if loaded else None)
    llm.runtime.unload = lambda model: calls.append(model)
    return calls


def test_switch_points_client_at_new_address(settings):
    llm = LLMService(settings)
    stub_runtime(llm, loaded=False)
    llm.update_config(patch_runtime(kind="ollama"))
    assert isinstance(llm.runtime, OllamaRuntime)
    assert str(llm._client.base_url).rstrip("/") == "http://localhost:11434/v1"


def test_new_model_frees_memory_of_old(settings):
    llm = LLMService(settings)
    old = llm.config.model.name
    calls = stub_runtime(llm)
    llm.update_config(patch_model(name="google/gemma-3-1b"))
    assert calls == [old]


def test_new_context_requires_new_load(settings):
    llm = LLMService(settings)
    calls = stub_runtime(llm)
    llm.update_config(patch_model(context_length=4096))
    assert len(calls) == 1


def test_answer_length_does_not_touch_the_model(settings):
    llm = LLMService(settings)
    calls = stub_runtime(llm)
    llm.update_config(patch_model(max_tokens=256))
    assert calls == []
    assert llm._answer_request("q", [], "en")["max_tokens"] == 256


def test_failed_unload_does_not_block_switch(settings):
    llm = LLMService(settings)
    stub_runtime(llm)

    def fail(_):
        raise ModelLoadError("lms unload failed")

    llm.runtime.unload = fail
    llm.update_config(patch_model(name="google/gemma-3-1b"))
    assert llm.config.model.name == "google/gemma-3-1b"


def test_refused_while_loading(settings):
    llm = LLMService(settings)
    with _load_lock:
        with pytest.raises(ModelBusyError):
            llm.update_config(patch_runtime(port=1235))
    assert llm.config.runtime.port == 1234


def test_failed_start_is_reported(settings, monkeypatch):
    """Порт занят чужой программой: сервер не поднялся, хотя команда не упала."""
    llm = LLMService(settings)
    monkeypatch.setattr(llm.runtime, "state", lambda _: (None, None))
    monkeypatch.setattr(llm.runtime, "ping", lambda: False)
    monkeypatch.setattr(llm.runtime, "start", lambda: None)
    with pytest.raises(ModelLoadError, match="localhost:1234"):
        llm.load_model()


# --- LM Studio -----------------------------------------------------------------


def test_lmstudio_lists_models_without_embeddings_and_banned(monkeypatch):
    data = [
        {"id": "ministral", "type": "vlm", "state": "loaded", "max_context_length": 262144},
        {"id": "qwen3-4b", "type": "llm", "state": "not-loaded"},
        {"id": "text-embedding-nomic", "type": "embeddings", "state": "not-loaded"},
    ]
    monkeypatch.setattr(llm_runtime.httpx, "get", lambda *a, **k: answer({"data": data}))
    models = LMStudioRuntime(RuntimeConfig(), 10).models()
    assert models == [{"id": "ministral", "loaded": True, "max_context_length": 262144}]


def test_lmstudio_starts_on_configured_port(monkeypatch):
    calls = []
    monkeypatch.setattr(llm_runtime, "find_lms", lambda: "/bin/lms")
    monkeypatch.setattr(
        subprocess, "run",
        lambda command, **_: calls.append(command[1:]) or SimpleNamespace(returncode=0, stdout="", stderr=""),
    )
    LMStudioRuntime(RuntimeConfig(port=1235), 10).start()
    assert calls == [["server", "start", "--port", "1235"]]


def test_lmstudio_missing_model_is_short(monkeypatch):
    details = 'Model not found\n\nNo model found that matches model key "x".\n\nlms ls'
    monkeypatch.setattr(llm_runtime, "find_lms", lambda: "/bin/lms")
    monkeypatch.setattr(subprocess, "run", lambda *_, **__: SimpleNamespace(returncode=1, stdout="", stderr=details))
    with pytest.raises(ModelLoadError, match="^Model x is not in LM Studio"):
        LMStudioRuntime(RuntimeConfig(), 10).load("x", 8192)


# --- Ollama --------------------------------------------------------------------


@pytest.fixture
def ollama():
    return OllamaRuntime(RuntimeConfig(kind="ollama", port=11434), 10)


def test_ollama_state(ollama, monkeypatch):
    payload = {"models": [{"name": "ministral:latest", "context_length": 4096}]}
    monkeypatch.setattr(llm_runtime.httpx, "get", lambda url, **_: answer(payload))
    assert ollama.state("ministral") == (True, 4096)
    assert ollama.state("ministral:latest") == (True, 4096)
    assert ollama.state("gemma") == (False, None)


def test_ollama_state_when_down(ollama, monkeypatch):
    def down(*_, **__):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(llm_runtime.httpx, "get", down)
    assert ollama.state("ministral") == (None, None)
    with pytest.raises(ModelLoadError, match="localhost:11434"):
        ollama.models()


def test_ollama_lists_models_without_banned(ollama, monkeypatch):
    def get(url, **_):
        if url.endswith("/api/tags"):
            return answer({"models": [{"name": "ministral-3:3b"}, {"name": "qwen3:4b"}, {"name": "gemma3:1b"}]})
        return answer({"models": [{"name": "gemma3:1b"}]})

    monkeypatch.setattr(llm_runtime.httpx, "get", get)
    assert ollama.models() == [
        {"id": "ministral-3:3b", "loaded": False, "max_context_length": None},
        {"id": "gemma3:1b", "loaded": True, "max_context_length": None},
    ]


@pytest.mark.parametrize("action, keep_alive", [("load", -1), ("unload", 0)])
def test_ollama_load_and_unload(ollama, monkeypatch, action, keep_alive):
    calls = []
    monkeypatch.setattr(
        llm_runtime.httpx, "post",
        lambda url, json, **_: calls.append((url, json)) or answer({"done": True}),
    )
    if action == "load":
        ollama.load("ministral", 8192)
    else:
        ollama.unload("ministral")
    assert calls == [("http://localhost:11434/api/generate", {"model": "ministral", "keep_alive": keep_alive})]


def test_ollama_missing_model_says_how_to_get_it(ollama, monkeypatch):
    monkeypatch.setattr(llm_runtime.httpx, "post", lambda *a, **k: answer({"error": "not found"}, 404))
    with pytest.raises(ModelLoadError, match="ollama pull ministral"):
        ollama.load("ministral", 8192)


def test_ollama_low_memory_is_explained(ollama, monkeypatch):
    payload = {"error": "model requires more system memory (5 GiB) than is available"}
    monkeypatch.setattr(llm_runtime.httpx, "post", lambda *a, **k: answer(payload, 500))
    with pytest.raises(ModelLoadError, match="memory"):
        ollama.load("ministral", 8192)


def test_ollama_starts_on_configured_port(monkeypatch):
    runtime = OllamaRuntime(RuntimeConfig(kind="ollama", port=11500), 10)
    spawned = {}
    monkeypatch.setattr(llm_runtime, "find_ollama", lambda: "/bin/ollama")
    monkeypatch.setattr(subprocess, "Popen", lambda command, env, **_: spawned.update(command=command, host=env["OLLAMA_HOST"]))
    monkeypatch.setattr(runtime, "ping", lambda: True)
    runtime.start()
    assert spawned == {"command": ["/bin/ollama", "serve"], "host": "localhost:11500"}


def test_ollama_not_installed(ollama, monkeypatch):
    monkeypatch.setattr(llm_runtime, "find_ollama", lambda: None)
    with pytest.raises(ModelLoadError, match="install Ollama"):
        ollama.start()


def test_remote_ollama_is_not_ours_to_start(monkeypatch):
    with pytest.raises(ModelLoadError, match="10.0.0.5"):
        OllamaRuntime(RuntimeConfig(kind="ollama", host="10.0.0.5"), 10).start()


def test_ollama_context_is_not_reloaded(settings, monkeypatch):
    """Контекст Ollama не задаётся отсюда: перезагрузка его бы не изменила."""
    settings.llm_config_path.write_text(json.dumps({
        "runtime": {"kind": "ollama", "host": "localhost", "port": 11434},
        "model": {"name": "ministral", "context_length": 2048, "max_tokens": 512},
    }))
    llm = LLMService(settings)
    calls = []
    monkeypatch.setattr(llm.runtime, "state", lambda _: (True, 32768))
    monkeypatch.setattr(llm.runtime, "unload", calls.append)
    llm.load_model()
    assert calls == []


# --- API -----------------------------------------------------------------------


@pytest.fixture
def api(client, settings):
    llm = LLMService(settings)
    llm.runtime.ping = lambda: True
    llm.runtime.state = lambda _: (False, None)
    llm.runtime.models = lambda: [{"id": llm.config.model.name, "loaded": False, "max_context_length": 8192}]
    app.dependency_overrides[get_llm_service] = lambda: llm
    yield client
    app.dependency_overrides.pop(get_llm_service, None)


def test_read_config(api):
    body = api.get("/v1/llm/config").json()
    assert body["runtime"] == {
        "kind": "lmstudio", "name": "LM Studio", "host": "localhost", "port": 1234,
        "controls_context": True, "reachable": True,
    }
    assert body["model"]["available"] is True
    assert body["embedding_model"] == get_settings().embedding_model


def test_patch_config_applies_at_once(api):
    body = api.patch("/v1/llm/config", json={"runtime": {"kind": "ollama"}}).json()
    assert (body["runtime"]["name"], body["runtime"]["port"]) == ("Ollama", 11434)
    assert body["runtime"]["controls_context"] is False
    assert body["runtime"]["reachable"] is False  # настоящего Ollama в тестах нет
    assert body["model"]["available"] is None


def test_patch_refuses_with_a_reason(api):
    response = api.patch("/v1/llm/config", json={"model": {"name": "qwen3-4b-instruct-2507"}})
    assert response.status_code == 422
    assert "banned" in response.json()["detail"]


def test_patch_while_loading_is_conflict(api):
    with _load_lock:
        assert api.patch("/v1/llm/config", json={"runtime": {"port": 1235}}).status_code == 409


def test_delete_config_resets(api, settings):
    api.patch("/v1/llm/config", json={"model": {"max_tokens": 256}})
    assert api.delete("/v1/llm/config").json()["model"]["max_tokens"] == default_config(settings).model.max_tokens


def test_models_endpoint(api):
    body = api.get("/v1/llm/models").json()
    assert body["runtime"] == "lmstudio"
    assert body["models"][0]["loaded"] is False


def test_models_endpoint_when_runtime_is_down(client, settings, monkeypatch):
    def down(*_, **__):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(llm_runtime.httpx, "get", down)
    app.dependency_overrides[get_llm_service] = lambda: LLMService(settings)
    response = client.get("/v1/llm/models")
    app.dependency_overrides.pop(get_llm_service, None)
    assert response.status_code == 503
    assert "localhost:1234" in response.json()["detail"]


def test_health_names_the_runtime(client):
    body = client.get("/v1/health").json()
    assert body["runtime_name"] == "LM Studio"
    assert body["runtime_address"] == "localhost:1234"
    assert body["model_context_limit"] == 8192


# --- sfss config ---------------------------------------------------------------


@pytest.fixture
def daemon_off(monkeypatch, settings):
    """Демона нет: команда работает с файлом настроек."""

    class Refused:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def request(self, *_, **__):
            raise httpx.ConnectError("refused")

    monkeypatch.setattr(cli, "make_client", lambda *_, **__: Refused())
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.delenv("SFSS_URL", raising=False)
    return settings


def test_cli_runtime_without_daemon_writes_file(daemon_off, capsys):
    assert cli.main(["config", "runtime", "ollama", "--port", "11500"]) == 0
    output = capsys.readouterr().out
    assert "takes effect on sfss start" in output
    assert "Ollama, localhost:11500" in output
    assert "OLLAMA_CONTEXT_LENGTH" in output
    assert load_config(daemon_off).runtime.port == 11500


def test_cli_model_without_daemon_writes_file(daemon_off, capsys):
    assert cli.main(["config", "model", "google/gemma-3-1b", "--context", "4096", "--max-tokens", "256"]) == 0
    model = load_config(daemon_off).model
    assert (model.name, model.context_length, model.max_tokens) == ("google/gemma-3-1b", 4096, 256)


def test_cli_banned_model_without_daemon_is_refused(daemon_off, capsys):
    assert cli.main(["config", "model", "qwen3-4b-instruct-2507"]) == 1
    assert "banned" in capsys.readouterr().err
    assert not daemon_off.llm_config_path.exists()


def test_cli_reset_without_daemon(daemon_off, capsys):
    cli.main(["config", "runtime", "--port", "1235"])
    assert cli.main(["config", "reset"]) == 0
    assert not daemon_off.llm_config_path.exists()


def test_cli_show_without_daemon(daemon_off, capsys):
    assert cli.main(["config"]) == 0
    output = capsys.readouterr().out
    assert "saved settings" in output
    assert "LM Studio, localhost:1234" in output


def test_cli_explicit_address_does_not_fall_back_to_file(daemon_off, capsys):
    """Настройка для другой машины не должна молча лечь в файл на этой."""
    assert cli.main(["config", "runtime", "--port", "1235", "--url", "http://10.0.0.5:8000"]) == cli.EXIT_NOT_RUNNING
    assert not daemon_off.llm_config_path.exists()


@pytest.mark.parametrize("command", [["config", "runtime"], ["config", "model"]])
def test_cli_nothing_to_change(daemon_off, capsys, command):
    assert cli.main(command) == 1
    assert "Say what to change" in capsys.readouterr().err


def test_cli_goes_through_daemon_when_it_runs(monkeypatch, capsys):
    sent = {}
    view = {
        "runtime": {"name": "Ollama", "host": "localhost", "port": 11434, "reachable": True, "controls_context": False},
        "model": {"name": "ministral", "max_tokens": 512, "available": False, "context_length": 8192},
        "embedding_model": "minilm",
    }

    class Daemon:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def request(self, method, path, json=None):
            sent.update(method=method, path=path, body=json)
            return httpx.Response(200, json=view, request=httpx.Request(method, "http://test"))

    monkeypatch.setattr(cli, "make_client", lambda *_, **__: Daemon())
    assert cli.main(["config", "runtime", "ollama"]) == 0
    assert sent == {"method": "PATCH", "path": "/v1/llm/config", "body": {"runtime": {"kind": "ollama"}}}
    output = capsys.readouterr().out
    assert "answering" in output
    assert "not in the runtime" in output
