from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    lm_studio_base_url: str = "http://localhost:1234/v1"
    lm_studio_model: str = "ministral-3-3b-instruct-2512"
    lm_studio_api_key: str = "lm-studio"
    lm_studio_timeout: float = 120.0
    llm_context_length: int = 8192
    llm_load_timeout: float = 180.0
    llm_config_path: Path = BASE_DIR / "data" / "llm.json"
    llm_max_tokens: int = 512

    index_dir: Path = BASE_DIR / "data" / "index"
    embedding_dir: Path = BASE_DIR / "data" / "embedding"
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"

    top_k: int = 3
    hybrid_search: bool = True
    hybrid_candidates: int = 20
    keyword_weight: float = 1.5
    translate_queries: bool = True
    answer_ru_via_english: bool = True
    chunk_size: int = 500
    chunk_overlap: int = 50

    warmup_on_startup: bool = True

    raw_dir: Path = BASE_DIR / "data" / "raw"
    processed_dir: Path = BASE_DIR / "data" / "processed"
    models_dir: Path = BASE_DIR / "data" / "models"
    max_upload_mb: int = 100
    max_batch_rows: int = 10_000
    sfss_api_key: str | None = None
    allowed_origins: str = (
        r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost"
        r"|https?://tauri\.localhost|null)$"
    )
    run_dir: Path = BASE_DIR / "data" / "run"

    llm_system_prompt: str = Field(
        default=(
            "Ты — ассистент по данным NASA PSI о горении в невесомости. "
            "Отвечай ТОЛЬКО на основе предоставленного контекста. "
            "Если контекста недостаточно — так и скажи, не додумывай. "
            "Отвечай кратко и по существу, без вступлений и повторов. "
            "После каждого утверждения ставь ссылку: заголовок фрагмента, на "
            "котором оно основано, в квадратных скобках, точно как в контексте. "
            "Пометка (formula omitted) значит, что формулу извлечь не удалось: "
            "сами формул не пиши, словами скажи, что от чего зависит."
        )
    )
    llm_system_prompt_en: str = Field(
        default=(
            "You answer questions about NASA microgravity combustion reports. "
            "Use ONLY the provided context. If it does not answer the question, "
            "say so and do not guess. Be brief, with no introduction or repetition. "
            "After every claim put a citation: the bracketed header of the fragment "
            "it comes from, copied exactly. Cite nothing else and add no source list. "
            "The mark (formula omitted) means an equation could not be extracted: "
            "never write equations yourself, say in words what depends on what."
        )
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
