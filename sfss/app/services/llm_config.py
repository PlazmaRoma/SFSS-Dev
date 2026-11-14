import json
import logging
import os
import re
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from app.config import Settings

logger = logging.getLogger(__name__)

RuntimeKind = Literal["lmstudio", "ollama"]
DEFAULT_PORTS: dict[str, int] = {"lmstudio": 1234, "ollama": 11434}

HOST = re.compile(r"^[A-Za-z0-9.-]+$|^\[[0-9A-Fa-f:]+\]$")
MODEL_NAME = re.compile(r"^[A-Za-z0-9][\w.:/@+-]*$")
BANNED_MODEL = re.compile(
    r"qwen|qwq|deepseek|glm|kimi|moonshot|minimax|baichuan|hunyuan|ernie|internlm|doubao|\byi-|\bbge-",
    re.IGNORECASE,
)


class ConfigError(ValueError):
    pass


class RuntimeConfig(BaseModel):
    kind: RuntimeKind = "lmstudio"
    host: str = "localhost"
    port: int = Field(default=DEFAULT_PORTS["lmstudio"], ge=1, le=65535)

    @field_validator("host")
    @classmethod
    def valid_host(cls, value: str) -> str:
        if not HOST.match(value):
            raise ValueError(f"host must be a name or an address, without http:// and port: {value}")
        return value

    @property
    def root(self) -> str:
        return f"http://{self.host}:{self.port}"


class ModelConfig(BaseModel):
    name: str
    context_length: int = Field(default=8192, ge=512, le=1_048_576)
    max_tokens: int = Field(default=512, ge=16, le=32_768)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if not MODEL_NAME.match(value):
            raise ValueError(f"not a model name: {value}")
        return value

    @model_validator(mode="after")
    def answer_fits_context(self) -> "ModelConfig":
        if self.max_tokens >= self.context_length:
            raise ValueError("max_tokens must be smaller than context_length")
        return self


class LLMConfig(BaseModel):
    runtime: RuntimeConfig
    model: ModelConfig


class RuntimePatch(BaseModel):
    kind: RuntimeKind | None = None
    host: str | None = None
    port: int | None = None


class ModelPatch(BaseModel):
    name: str | None = None
    context_length: int | None = None
    max_tokens: int | None = None


class LLMConfigPatch(BaseModel):
    runtime: RuntimePatch | None = None
    model: ModelPatch | None = None


def is_banned(model: str) -> bool:
    return BANNED_MODEL.search(model) is not None


def default_config(settings: Settings) -> LLMConfig:
    url = urlparse(settings.lm_studio_base_url)
    host = url.hostname or "localhost"
    return LLMConfig(
        runtime=RuntimeConfig(
            host=f"[{host}]" if ":" in host else host,
            port=url.port or DEFAULT_PORTS["lmstudio"],
        ),
        model=ModelConfig(
            name=settings.lm_studio_model,
            context_length=settings.llm_context_length,
            max_tokens=settings.llm_max_tokens,
        ),
    )


def load_config(settings: Settings) -> LLMConfig:
    try:
        return LLMConfig.model_validate_json(Path(settings.llm_config_path).read_text())
    except FileNotFoundError:
        pass
    except (OSError, ValueError) as exc:
        logger.warning("Cannot read %s: %s", settings.llm_config_path, exc)
    return default_config(settings)


def save_config(settings: Settings, config: LLMConfig) -> None:
    path = Path(settings.llm_config_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(config.model_dump(), ensure_ascii=False, indent=2))
    os.replace(temporary, path)


def forget_config(settings: Settings) -> None:
    Path(settings.llm_config_path).unlink(missing_ok=True)


def apply_patch(config: LLMConfig, patch: LLMConfigPatch) -> LLMConfig:
    runtime = config.runtime.model_dump()
    model = config.model.model_dump()
    if patch.runtime:
        changes = patch.runtime.model_dump(exclude_none=True)
        if "kind" in changes and changes["kind"] != runtime["kind"]:
            runtime["port"] = DEFAULT_PORTS[changes["kind"]]
        runtime.update(changes)
    if patch.model:
        model.update(patch.model.model_dump(exclude_none=True))
        if patch.model.name and is_banned(patch.model.name):
            raise ConfigError(f"Model {patch.model.name} is banned by the Space Apps rules")
    try:
        return LLMConfig(runtime=RuntimeConfig(**runtime), model=ModelConfig(**model))
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(part) for part in first["loc"])
        message = first["msg"].removeprefix("Value error, ")
        raise ConfigError(f"{field}: {message}" if field else message) from exc
