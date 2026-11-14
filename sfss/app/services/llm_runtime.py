import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

import httpx

from app.services.llm_config import RuntimeConfig, is_banned

logger = logging.getLogger(__name__)

PROBE_TIMEOUT = httpx.Timeout(2.0, connect=1.0)
LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")
OLLAMA_START_TIMEOUT = 15.0


class ModelLoadError(RuntimeError):
    pass


def find_lms() -> str | None:
    folder = Path.home() / ".lmstudio" / "bin"
    places = (folder / "lms", folder / "lms.exe")
    return shutil.which("lms") or next((str(place) for place in places if place.exists()), None)


def find_ollama() -> str | None:
    places = (
        "/opt/homebrew/bin/ollama",
        "/usr/local/bin/ollama",
        "/Applications/Ollama.app/Contents/Resources/ollama",
        str(Path.home() / "AppData" / "Local" / "Programs" / "Ollama" / "ollama.exe"),
    )
    return shutil.which("ollama") or next((place for place in places if Path(place).exists()), None)


class Runtime:
    name = ""
    controls_context = True

    def __init__(self, config: RuntimeConfig, load_timeout: float) -> None:
        self.config = config
        self.load_timeout = load_timeout

    @property
    def root(self) -> str:
        return self.config.root

    @property
    def address(self) -> str:
        return f"{self.config.host}:{self.config.port}"

    @property
    def is_local(self) -> bool:
        return self.config.host in LOCAL_HOSTS

    def ping(self) -> bool:
        try:
            httpx.get(f"{self.root}/v1/models", timeout=PROBE_TIMEOUT).raise_for_status()
            return True
        except Exception:
            logger.warning("%s is unavailable at %s", self.name, self.address)
            return False

    def state(self, model: str) -> tuple[bool | None, int | None]:
        raise NotImplementedError

    def models(self) -> list[dict]:
        raise NotImplementedError

    def start(self) -> None:
        raise NotImplementedError

    def load(self, model: str, context_length: int) -> None:
        raise NotImplementedError

    def unload(self, model: str) -> None:
        raise NotImplementedError

    def _unreachable(self) -> ModelLoadError:
        return ModelLoadError(f"{self.name} is not responding at {self.address}")


class LMStudioRuntime(Runtime):
    name = "LM Studio"

    def _models(self) -> list[dict]:
        response = httpx.get(f"{self.root}/api/v0/models", timeout=PROBE_TIMEOUT)
        response.raise_for_status()
        return response.json()["data"]

    def state(self, model: str) -> tuple[bool | None, int | None]:
        try:
            models = self._models()
        except Exception:
            return None, None
        for item in models:
            if item.get("id") == model:
                return item.get("state") == "loaded", item.get("loaded_context_length")
        return False, None

    def models(self) -> list[dict]:
        try:
            models = self._models()
        except Exception as exc:
            raise self._unreachable() from exc
        return [
            {
                "id": item["id"],
                "loaded": item.get("state") == "loaded",
                "max_context_length": item.get("max_context_length"),
            }
            for item in models
            if item.get("type") != "embeddings" and not is_banned(item["id"])
        ]

    def start(self) -> None:
        self._lms("server", "start", "--port", str(self.config.port))

    def load(self, model: str, context_length: int) -> None:
        self._lms("load", model, "--context-length", str(context_length), "--yes")

    def unload(self, model: str) -> None:
        self._lms("unload", model)

    def _lms(self, *args: str) -> None:
        if not self.is_local:
            raise ModelLoadError(f"LM Studio runs on {self.config.host}: load the model there")
        lms = find_lms()
        if lms is None:
            raise ModelLoadError("The lms command was not found: install LM Studio")
        try:
            result = subprocess.run([lms, *args], capture_output=True, text=True, timeout=self.load_timeout)
        except subprocess.TimeoutExpired as exc:
            raise ModelLoadError(f"lms {args[0]} did not finish in {self.load_timeout:.0f} s") from exc
        if result.returncode != 0:
            details = (result.stderr or result.stdout).strip()
            if "insufficient system resources" in details:
                raise ModelLoadError("Not enough memory for the model: close heavy programs and retry")
            if "No model found" in details:
                raise ModelLoadError(f"Model {args[1]} is not in LM Studio: download it there")
            raise ModelLoadError(f"lms {args[0]} failed: {details}")


class OllamaRuntime(Runtime):
    name = "Ollama"
    controls_context = False

    @staticmethod
    def _same(name: str, model: str) -> bool:
        return name in (model, f"{model}:latest")

    def state(self, model: str) -> tuple[bool | None, int | None]:
        try:
            response = httpx.get(f"{self.root}/api/ps", timeout=PROBE_TIMEOUT)
            response.raise_for_status()
            running = response.json()["models"]
        except Exception:
            return None, None
        for item in running:
            if self._same(item.get("name", ""), model):
                return True, item.get("context_length")
        return False, None

    def models(self) -> list[dict]:
        try:
            response = httpx.get(f"{self.root}/api/tags", timeout=PROBE_TIMEOUT)
            response.raise_for_status()
            names = [item["name"] for item in response.json()["models"]]
            running = httpx.get(f"{self.root}/api/ps", timeout=PROBE_TIMEOUT).json()["models"]
        except Exception as exc:
            raise self._unreachable() from exc
        loaded = {item.get("name") for item in running}
        return [
            {"id": name, "loaded": name in loaded, "max_context_length": None}
            for name in names
            if not is_banned(name)
        ]

    def start(self) -> None:
        if not self.is_local:
            raise ModelLoadError(f"Ollama runs on {self.config.host}: start it there")
        ollama = find_ollama()
        if ollama is None:
            raise ModelLoadError("The ollama command was not found: install Ollama")
        subprocess.Popen(
            [ollama, "serve"],
            env={**os.environ, "OLLAMA_HOST": f"{self.config.host}:{self.config.port}"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        deadline = time.monotonic() + OLLAMA_START_TIMEOUT
        while time.monotonic() < deadline and not self.ping():
            time.sleep(0.5)

    def load(self, model: str, context_length: int) -> None:
        self._generate(model, keep_alive=-1)

    def unload(self, model: str) -> None:
        self._generate(model, keep_alive=0)

    def _generate(self, model: str, keep_alive: int) -> None:
        try:
            response = httpx.post(
                f"{self.root}/api/generate",
                json={"model": model, "keep_alive": keep_alive},
                timeout=self.load_timeout,
            )
        except httpx.TimeoutException as exc:
            raise ModelLoadError(f"Ollama did not load the model in {self.load_timeout:.0f} s") from exc
        except httpx.HTTPError as exc:
            raise self._unreachable() from exc
        if response.status_code == 404:
            raise ModelLoadError(f"Model {model} is not in Ollama: ollama pull {model}")
        if response.is_error:
            details = response.text
            if "more system memory" in details:
                raise ModelLoadError("Not enough memory for the model: close heavy programs and retry")
            raise ModelLoadError(f"Ollama failed: {details}")


def make_runtime(config: RuntimeConfig, load_timeout: float) -> Runtime:
    kinds = {"lmstudio": LMStudioRuntime, "ollama": OllamaRuntime}
    return kinds[config.kind](config, load_timeout)
