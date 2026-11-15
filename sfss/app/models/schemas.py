"""Pydantic-схемы запросов и ответов API (раздел 4 ТЗ)."""

from typing import Any, Literal

from pydantic import BaseModel, Field


# --- /health ---------------------------------------------------------------


class LoadModelResponse(BaseModel):
    model: str
    model_loaded: bool | None
    model_context_length: int | None


class LLMRuntimeInfo(BaseModel):
    kind: str
    name: str
    host: str
    port: int
    controls_context: bool = Field(description="Контекст задаётся здесь. False — в настройках самого рантайма")
    reachable: bool


class LLMModelInfo(BaseModel):
    name: str
    context_length: int
    max_tokens: int
    available: bool | None = Field(description="Есть ли модель у рантайма. None — рантайм не отвечает")


class LLMConfigResponse(BaseModel):
    runtime: LLMRuntimeInfo
    model: LLMModelInfo
    embedding_model: str = Field(description="Только чтение: со сменой нужна новая индексация отчётов")


class LLMModelEntry(BaseModel):
    id: str
    loaded: bool
    max_context_length: int | None
    selected: bool = Field(False, description="Это модель из настроек: найдена по полному или короткому имени")


class LLMModelsResponse(BaseModel):
    runtime: str
    models: list[LLMModelEntry]


class HealthResponse(BaseModel):
    status: str = Field(description="ok | degraded")
    chroma: bool = Field(description="Индекс по отчётам на месте. Имя поля прежнее ради совместимости")
    lm_studio: bool = Field(description="Рантайм нейросети отвечает. Имя старое: раньше он был один")
    runtime: str = Field(default="lmstudio", description="lmstudio | ollama")
    runtime_name: str = Field(default="LM Studio", description="Название рантайма для человека")
    runtime_address: str | None = Field(default=None, description="Адрес и порт рантайма")
    model: str = Field(description="Идентификатор модели из настроек")
    indexed_documents: int | None = Field(
        default=None, description="Число чанков в коллекции, None если Chroma недоступна"
    )
    model_loaded: bool | None = Field(
        default=None,
        description=(
            "Модель уже в памяти. False — сервис загрузит её при первом вопросе, "
            "и этот вопрос будет заметно дольше. None — сервер не сообщает состояние"
        ),
    )
    model_context_length: int | None = Field(
        default=None, description="Длина контекста загруженной модели, None если не загружена"
    )
    model_context_limit: int | None = Field(
        default=None, description="Контекст из настроек. None — его задаёт сам рантайм"
    )
    model_loading: bool = Field(default=False, description="Сервис прямо сейчас загружает модель")


# --- /query ----------------------------------------------------------------


class QueryRequest(BaseModel):
    question: str = Field(min_length=1)
    filters: dict[str, Any] | None = Field(
        default=None, description="Метаданные-фильтры для Chroma (doc_id, источник, ...)"
    )
    language: Literal["ru", "en"] | None = Field(
        default=None,
        description=(
            "Язык ответа. Инструкция уходит только в промпт LLM, поиск видит один "
            "вопрос. None — без инструкции: модель обычно отвечает по-русски, "
            "потому что системный промпт русский"
        ),
    )


class Source(BaseModel):
    doc_id: str
    excerpt: str
    page: int | None = None


class QueryResponse(BaseModel):
    answer: str
    sources: list[Source] = Field(default_factory=list)
    search_query: str | None = Field(
        default=None,
        description="Английский перевод вопроса, по которому шёл поиск; None — искали по самому вопросу",
    )


# --- /predict --------------------------------------------------------------


class PredictRequest(BaseModel):
    parameters: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Условия опыта. Достаточно передать только то, что отличается от "
            "значений по умолчанию (см. model.defaults в /dashboard); остальное "
            "подставится. Например: {'oxygen_level': 0.30}"
        ),
    )


class ChartData(BaseModel):
    x: list[float] = Field(default_factory=list)
    y: list[float] = Field(default_factory=list)


class PredictResponse(BaseModel):
    risk_score: float
    cluster: int | None = None
    chart_data: ChartData = Field(default_factory=ChartData)
    predicted_value: float | None = Field(
        default=None,
        description=(
            "Предсказанная физическая величина в исходных единицах, если модель "
            "решает задачу регрессии (например скорость горения, мм²/с)"
        ),
    )
    target: str | None = Field(
        default=None, description="Что именно предсказано: имя целевой переменной"
    )
    defaults_applied: list[str] = Field(
        default_factory=list,
        description=(
            "Признаки, которых не было в запросе и которые подставлены "
            "значениями по умолчанию. Фронту стоит показать это пользователю"
        ),
    )
    is_heuristic: bool = Field(
        default=False,
        description=(
            "True — значение получено эвристикой при отсутствии целевой переменной, "
            "а не предсказанием обученной модели (п. 5.3 ТЗ)"
        ),
    )
    warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Почему числу стоит доверять меньше: условия вне диапазона обучения, "
            "сумма долей газов не равна единице. Показывать рядом с результатом"
        ),
    )


class BatchRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(description="Условия, как parameters в /predict")


class BatchRow(BaseModel):
    row: int = Field(description="Номер строки во входных данных, с единицы")
    predicted_value: float | None = None
    risk_score: float | None = None
    cluster: int | None = None
    defaults_applied: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = Field(
        default=None, description="Почему строка не посчитана; остальные строки это не затрагивает"
    )


class BatchResponse(BaseModel):
    target: str | None = None
    is_heuristic: bool = False
    total: int
    failed: int
    rows: list[BatchRow]


# --- /v1/documents ----------------------------------------------------------


class DocumentInfo(BaseModel):
    doc_id: str
    filename: str
    chunks: int = Field(description="Фрагментов в индексе")
    size_bytes: int


class DocumentsResponse(BaseModel):
    documents: list[DocumentInfo]


# --- /ingest ---------------------------------------------------------------


class IngestRequest(BaseModel):
    force: bool = Field(default=False, description="Переиндексировать уже загруженные файлы")


class IngestResponse(BaseModel):
    indexed_files: list[str] = Field(default_factory=list)
    skipped_files: list[str] = Field(default_factory=list)
    chunks_added: int = 0


# --- /dashboard -------------------------------------------------------------


class ExperimentPoint(BaseModel):
    """Один реальный опыт FLEX — точка на графике."""

    test: str
    fuel: str
    oxygen_level: float | None = None
    pressure_mmhg: float | None = None
    d_initial_mm: float | None = None
    burn_rate_mm2s: float | None = None
    d_extinction_mm: float | None = None
    test_end: str | None = None


class DatasetInfo(BaseModel):
    name: str
    source: str = Field(description="Откуда взяты данные")
    rows: int = Field(description="Всего опытов в датасете")
    experiments: list[ExperimentPoint] = Field(default_factory=list)


class ModelInfo(BaseModel):
    name: str = "fiery"
    task: str = Field(description="regression или classification")
    target: str = Field(description="Что предсказывает")
    units: str | None = Field(default=None, description="Единицы целевой величины")
    target_range: list[float] | None = Field(
        default=None, description="Диапазон цели на обучающей выборке"
    )
    metrics: dict[str, float] = Field(
        default_factory=dict, description="Качество на кросс-валидации"
    )
    feature_importance: dict[str, float] = Field(default_factory=dict)
    features: list[str] = Field(default_factory=list)
    defaults: dict[str, float] = Field(
        default_factory=dict,
        description="Значения по умолчанию — ими инициализируются ползунки на фронте",
    )
    is_heuristic: bool = False
    trained: bool = Field(description="False — модель не обучена, /predict вернёт 503")


class CorpusInfo(BaseModel):
    chunks: int = Field(description="Фрагментов в векторной базе")
    documents: list[str] = Field(default_factory=list)
    embedding_model: str


class DashboardResponse(BaseModel):
    model: ModelInfo
    dataset: DatasetInfo
    corpus: CorpusInfo
