import json
import subprocess
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.services import llm_runtime
from app.services.llm_service import LLMService, ModelLoadError

from .conftest import FakeLLMService


@pytest.fixture
def service(monkeypatch):
    calls: list[list[str]] = []
    state = SimpleNamespace(up=True, loaded=(False, None), returncode=0, stderr="")
    llm = LLMService(Settings(_env_file=None))

    def run(command, **_):
        calls.append(command[1:])
        if command[1:3] == ["server", "start"]:
            state.up = True
        return SimpleNamespace(returncode=state.returncode, stdout="", stderr=state.stderr)

    monkeypatch.setattr(llm_runtime, "find_lms", lambda: "/bin/lms")
    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setattr(llm, "ping", lambda: state.up)
    monkeypatch.setattr(llm, "model_state", lambda: state.loaded)
    return llm, calls, state


def test_load_uses_small_context(service):
    llm, calls, _ = service
    llm.load_model()
    assert calls == [["load", llm.settings.lm_studio_model, "--context-length", "8192", "--yes"]]


def test_load_starts_server_first(service):
    llm, calls, state = service
    state.up = False
    state.loaded = (None, None)
    llm.load_model()
    assert calls[0] == ["server", "start", "--port", "1234"]
    assert calls[1][0] == "load"


def test_server_restart_does_not_load_second_copy(service, monkeypatch):
    llm, calls, state = service
    state.up = False
    state.loaded = (None, None)
    states = iter([(None, None), (True, 8192)])
    monkeypatch.setattr(llm, "model_state", lambda: next(states))
    llm.load_model()
    assert calls == [["server", "start", "--port", "1234"]]


def test_low_memory_is_explained(service):
    llm, _, state = service
    state.returncode = 1
    state.stderr = "Error: Model loading was stopped due to insufficient system resources."
    with pytest.raises(ModelLoadError, match="memory"):
        llm.load_model()


def test_loaded_model_is_left_alone(service):
    llm, calls, state = service
    state.loaded = (True, 8192)
    llm.load_model()
    assert calls == []


def test_too_big_context_is_reloaded(service):
    llm, calls, state = service
    state.loaded = (True, 262144)
    llm.load_model()
    assert [call[0] for call in calls] == ["unload", "load"]


def test_failure_explains_itself(service):
    llm, _, state = service
    state.returncode = 1
    state.stderr = "model not found"
    with pytest.raises(ModelLoadError, match="model not found"):
        llm.load_model()


def test_no_lms(service, monkeypatch):
    llm, _, _ = service
    monkeypatch.setattr(llm_runtime, "find_lms", lambda: None)
    with pytest.raises(ModelLoadError, match="lms"):
        llm.load_model()


def test_remote_server_is_not_ours_to_load(monkeypatch):
    llm = LLMService(Settings(_env_file=None, lm_studio_base_url="http://10.0.0.5:1234/v1"))
    monkeypatch.setattr(llm, "model_state", lambda: (False, None))
    with pytest.raises(ModelLoadError, match="10.0.0.5"):
        llm.load_model()


def test_unload(service):
    llm, calls, state = service
    state.loaded = (True, 8192)
    llm.unload_model()
    assert calls == [["unload", llm.settings.lm_studio_model]]


def test_unload_when_not_loaded_does_nothing(service):
    llm, calls, _ = service
    llm.unload_model()
    assert calls == []


def test_unload_endpoint(client):
    assert client.post("/v1/llm/unload").status_code == 200


def test_unload_endpoint_reports_failure(client, monkeypatch):
    def fail(_):
        raise ModelLoadError("lms unload failed")

    monkeypatch.setattr(FakeLLMService, "unload_model", fail)
    response = client.post("/v1/llm/unload")
    assert response.status_code == 503
    assert response.json()["detail"] == "lms unload failed"


def test_needs_load(service):
    llm, _, state = service
    assert llm.needs_load() is True
    state.loaded = (True, 8192)
    assert llm.needs_load() is False
    state.loaded = (None, None)
    assert llm.needs_load() is False
    state.up = False
    assert llm.needs_load() is True


def test_endpoint(client):
    response = client.post("/v1/llm/load")
    assert response.status_code == 200
    assert response.json()["model_loaded"] is True
    assert response.json()["model_context_length"] == 8192


def test_endpoint_reports_failure(client, monkeypatch):
    def fail(_):
        raise ModelLoadError("lms load не удался")

    monkeypatch.setattr(FakeLLMService, "load_model", fail)
    response = client.post("/v1/llm/load")
    assert response.status_code == 503
    assert response.json()["detail"] == "lms load не удался"


def test_stream_says_it_is_loading(client, monkeypatch):
    monkeypatch.setattr(FakeLLMService, "needs_load", lambda _: True)
    response = client.post("/v1/query/stream", json={"question": "Why?", "language": "en"})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0] == {"type": "stage", "stage": "loading"}
    assert events[1] == {"type": "stage", "stage": "searching"}
    assert events[2]["type"] == "sources"
    assert events[-1]["type"] == "done"


def test_stream_reports_load_failure(client, monkeypatch):
    def fail(_):
        raise ModelLoadError("нет модели")

    monkeypatch.setattr(FakeLLMService, "needs_load", lambda _: True)
    monkeypatch.setattr(FakeLLMService, "load_model", fail)
    response = client.post("/v1/query/stream", json={"question": "Why?", "language": "en"})
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1] == {"type": "error", "detail": "нет модели"}


def test_query_reports_load_failure(client, monkeypatch):
    def fail(_):
        raise ModelLoadError("нет модели")

    monkeypatch.setattr(FakeLLMService, "needs_load", lambda _: True)
    monkeypatch.setattr(FakeLLMService, "load_model", fail)
    response = client.post("/v1/query", json={"question": "Why?", "language": "en"})
    assert response.status_code == 503
    assert response.json()["detail"] == "нет модели"
