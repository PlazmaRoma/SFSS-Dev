"""Конфигурация приложения: пути, параметры retrieval, нейросеть по умолчанию."""

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

    # LM Studio (OpenAI-совместимый локальный сервер)
    lm_studio_base_url: str = "http://localhost:1234/v1"
    # Ministral 3B, MLX 4bit, от Mistral AI (Франция). Китайские модели запрещены
    # регламентом в любом виде (ARCHITECTURE § 7.18). Грузить с контекстом 8192.
    lm_studio_model: str = "ministral-3-3b-instruct-2512"
    # LM Studio ключ не проверяет, но openai-клиент требует непустое значение
    lm_studio_api_key: str = "lm-studio"
    lm_studio_timeout: float = 120.0
    # С этим контекстом модель грузит сам сервис. Без него LM Studio поднимает
    # её при первом запросе с контекстом 262 144, и на 8 ГБ это своп.
    llm_context_length: int = 8192
    llm_load_timeout: float = 180.0
    # Что человек настроил сам: sfss config, GET и PATCH /v1/llm/config. Важнее .env
    llm_config_path: Path = BASE_DIR / "data" / "llm.json"
    # Без потолка модель генерирует, пока не решит остановиться сама, и время
    # ответа идёт за длиной: замеры давали от 7 до 61 секунды на один вопрос.
    # Задача профильная, а не свободная беседа — длинный ответ не нужен.
    llm_max_tokens: int = 512

    # Индекс и модель поиска (ARCHITECTURE § 7.23). Индекс лежит в git, модель
    # качается при установке: python -m app.services.embedder
    index_dir: Path = BASE_DIR / "data" / "index"
    embedding_dir: Path = BASE_DIR / "data" / "embedding"
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"

    # Retrieval и чанкинг (раздел 5 ТЗ)
    # top_k снижен с 5: меньше контекста — быстрее ответ. Качество retrieval
    # при этом падать не должно, но проверено не было (см. ARCHITECTURE § 11).
    top_k: int = 3
    # Корпус целиком английский, а многоязычная MiniLM плохо сводит русский
    # вопрос с английским текстом: на восьми темах русский вопрос находил
    # 8 из 24 фрагментов, найденных английским, переведённый — 15. Перевод
    # стоит около двух секунд в LM Studio. Ответ модель пишет по исходному
    # вопросу, перевод уходит только в поиск.
    # Гибридный поиск: векторы MiniLM + BM25 по словам, слияние RRF. MiniLM
    # промахивалась мимо фрагментов с конкретным термином (гелий, давление,
    # срыв пламени). Доля фрагментов по теме в топ-3: на 16 вопросах фронта
    # 46 из 48 против 30 у одних векторов, на 16 новых вопросах 41 против 26.
    # keyword_weight 1.5 лучший и на тех, и на других (ARCHITECTURE § 7.13).
    hybrid_search: bool = True
    hybrid_candidates: int = 20
    keyword_weight: float = 1.5
    translate_queries: bool = True
    # Русский ответ пишется по-английски и переводится второй просьбой к той же
    # модели. На восьми темах у Ministral 3B: латиницы в русском тексте 1 слово
    # против 6 при ответе сразу по-русски, среднее время 18 с против 22 —
    # кириллица стоит модели больше токенов на слово. Если перевод не удался,
    # модель отвечает по-русски напрямую.
    answer_ru_via_english: bool = True
    chunk_size: int = 500
    chunk_overlap: int = 50

    # Данные и артефакты моделей
    # Прогрев при старте: модель эмбеддингов весит сотни мегабайт и грузится
    # лениво, из-за чего первый запрос стоил 12.6 с вместо 1.3 с. Фронт,
    # опрашивающий /health, принимал это за зависший сервер.
    warmup_on_startup: bool = True

    raw_dir: Path = BASE_DIR / "data" / "raw"
    processed_dir: Path = BASE_DIR / "data" / "processed"
    models_dir: Path = BASE_DIR / "data" / "models"
    # Лимиты импорта: файл и пакет приходят извне, память и диск не резиновые
    max_upload_mb: int = 100
    max_batch_rows: int = 10_000
    # Ключ внешнего API. С этой машины ключ не нужен, с других адресов обязателен
    sfss_api_key: str | None = None
    # Каким страницам в браузере доверять: свои порты, окно Tauri, HTML-файл с
    # диска (Origin: null). Любой другой сайт мог бы без спроса обращаться к
    # API на localhost, в том числе загружать документы (ARCHITECTURE § 7.17).
    allowed_origins: str = (
        r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|tauri://localhost"
        r"|https?://tauri\.localhost|null)$"
    )
    # pid и лог демона, который поднимает команда sfss
    run_dir: Path = BASE_DIR / "data" / "run"

    llm_system_prompt: str = Field(
        default=(
            "Ты — ассистент по данным NASA PSI о горении в невесомости. "
            "Отвечай ТОЛЬКО на основе предоставленного контекста. "
            "Если контекста недостаточно — так и скажи, не додумывай. "
            "Отвечай кратко и по существу, без вступлений и повторов. "
            # Без шаблона вида [doc_id, стр. N]: модель на 3B копировала его
            # буквально: в русских ответах 16 ссылок из 26 выходили со словом
            # doc_id вместо номера отчёта.
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
