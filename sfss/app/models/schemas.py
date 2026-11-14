from typing import Any, Literal

from pydantic import BaseModel, Field


class LoadModelResponse(BaseModel):
    model: str
    model_loaded: bool | None
    model_context_length: int | None


class LLMRuntimeInfo(BaseModel):
    kind: str
    name: str
    host: str
    port: int
    controls_context: bool = Field(description="Context is set here. False means it is set in the runtime itself")
    reachable: bool


class LLMModelInfo(BaseModel):
    name: str
    context_length: int
    max_tokens: int
    available: bool | None = Field(description="Whether the runtime has the model. None means the runtime is not answering")


class LLMConfigResponse(BaseModel):
    runtime: LLMRuntimeInfo
    model: LLMModelInfo
    embedding_model: str = Field(description="Read only: changing it needs a new index of the reports")


class LLMModelEntry(BaseModel):
    id: str
    loaded: bool
    max_context_length: int | None


class LLMModelsResponse(BaseModel):
    runtime: str
    models: list[LLMModelEntry]


class HealthResponse(BaseModel):
    status: str = Field(description="ok | degraded")
    chroma: bool = Field(description="The report index is available. The name is kept for compatibility")
    lm_studio: bool = Field(description="The model runtime answers. The name is kept from when there was only one runtime")
    runtime: str = Field(default="lmstudio", description="lmstudio | ollama")
    runtime_name: str = Field(default="LM Studio", description="Human-readable runtime name")
    runtime_address: str | None = Field(default=None, description="Runtime host and port")
    model: str = Field(description="Model id from the settings")
    indexed_documents: int | None = Field(
        default=None, description="Number of chunks in the index, None if the index is unavailable"
    )
    model_loaded: bool | None = Field(
        default=None,
        description=(
            "The model is in memory. False means the service loads it on the first question, "
            "which then takes noticeably longer. None means the runtime does not report its state"
        ),
    )
    model_context_length: int | None = Field(
        default=None, description="Context length of the loaded model, None if not loaded"
    )
    model_context_limit: int | None = Field(
        default=None, description="Context from the settings. None means the runtime sets it"
    )
    model_loading: bool = Field(default=False, description="The service is loading the model right now")


class QueryRequest(BaseModel):
    question: str = Field(min_length=1)
    filters: dict[str, Any] | None = Field(
        default=None, description="Metadata filter, like a Chroma where clause (doc_id, source, ...)"
    )
    language: Literal["ru", "en"] | None = Field(
        default=None,
        description=(
            "Answer language. The instruction goes only to the model prompt; search sees "
            "the question alone. None means no instruction: the model usually answers "
            "in Russian, because the system prompt is Russian"
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
        description="English translation of the question used for search; None means the question itself was used",
    )


class PredictRequest(BaseModel):
    parameters: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Experiment conditions. Pass only what differs from the defaults "
            "(see model.defaults in /dashboard); the rest is filled in. "
            "For example: {'oxygen_level': 0.30}"
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
            "Predicted physical value in its own units, if the model is a regression "
            "(for example burning rate, mm²/s)"
        ),
    )
    target: str | None = Field(
        default=None, description="What is predicted: the target variable name"
    )
    defaults_applied: list[str] = Field(
        default_factory=list,
        description=(
            "Features missing from the request and filled with defaults. "
            "A client should show this to the user"
        ),
    )
    is_heuristic: bool = Field(
        default=False,
        description=(
            "True means the value comes from a heuristic, because there is no target "
            "variable, not from the trained model"
        ),
    )
    warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Why the number deserves less trust: conditions outside the training range, "
            "gas fractions not adding up to one. Show next to the result"
        ),
    )


class BatchRequest(BaseModel):
    rows: list[dict[str, Any]] = Field(description="Conditions, as parameters in /predict")


class BatchRow(BaseModel):
    row: int = Field(description="Row number in the input, starting at 1")
    predicted_value: float | None = None
    risk_score: float | None = None
    cluster: int | None = None
    defaults_applied: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = Field(
        default=None, description="Why the row was not calculated; other rows are not affected"
    )


class BatchResponse(BaseModel):
    target: str | None = None
    is_heuristic: bool = False
    total: int
    failed: int
    rows: list[BatchRow]


class DocumentInfo(BaseModel):
    doc_id: str
    filename: str
    chunks: int = Field(description="Chunks in the index")
    size_bytes: int


class DocumentsResponse(BaseModel):
    documents: list[DocumentInfo]


class IngestRequest(BaseModel):
    force: bool = Field(default=False, description="Re-index files that are already indexed")


class IngestResponse(BaseModel):
    indexed_files: list[str] = Field(default_factory=list)
    skipped_files: list[str] = Field(default_factory=list)
    chunks_added: int = 0


class ExperimentPoint(BaseModel):
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
    source: str = Field(description="Where the data comes from")
    rows: int = Field(description="Experiments in the dataset")
    experiments: list[ExperimentPoint] = Field(default_factory=list)


class ModelInfo(BaseModel):
    name: str = "fiery"
    task: str = Field(description="regression or classification")
    target: str = Field(description="What it predicts")
    units: str | None = Field(default=None, description="Units of the target")
    target_range: list[float] | None = Field(
        default=None, description="Target range in the training set"
    )
    metrics: dict[str, float] = Field(
        default_factory=dict, description="Cross-validated quality"
    )
    feature_importance: dict[str, float] = Field(default_factory=dict)
    features: list[str] = Field(default_factory=list)
    defaults: dict[str, float] = Field(
        default_factory=dict,
        description="Default values; clients use them to initialise their controls",
    )
    is_heuristic: bool = False
    trained: bool = Field(description="False means the model is not trained and /predict returns 503")


class CorpusInfo(BaseModel):
    chunks: int = Field(description="Chunks in the index")
    documents: list[str] = Field(default_factory=list)
    embedding_model: str


class DashboardResponse(BaseModel):
    model: ModelInfo
    dataset: DatasetInfo
    corpus: CorpusInfo
