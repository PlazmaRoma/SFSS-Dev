"""Фикстуры: сервисы подменяются заглушками, чтобы тесты не требовали
поднятого LM Studio и реальной ChromaDB."""

import os
import tempfile

# Выставляется до импорта приложения: TestClient запускает lifespan, а тот
# без этого грузил бы настоящую модель эмбеддингов — 12 секунд на ровном месте,
# при том что все сервисы всё равно подменены заглушками.
os.environ.setdefault("WARMUP_ON_STARTUP", "false")
# Настройки на этой машине не должны влиять на тесты, а тесты на них
os.environ["LLM_CONFIG_PATH"] = os.path.join(tempfile.mkdtemp(), "llm.json")

from types import SimpleNamespace  # noqa: E402
from typing import Any  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.dependencies import (  # noqa: E402
    get_dashboard_service,
    get_llm_service,
    get_ml_service,
    get_rag_service,
)
from app.main import app  # noqa: E402
from app.models.schemas import (  # noqa: E402
    BatchResponse,
    BatchRow,
    ChartData,
    CorpusInfo,
    DashboardResponse,
    DatasetInfo,
    ExperimentPoint,
    ModelInfo,
    PredictResponse,
    Source,
)


class FakeRagService:
    # Что ушло в поиск: инструкция о языке туда попадать не должна
    last_question: str | None = None

    def ping(self) -> bool:
        return True

    def count(self) -> int:
        return 3

    def retrieve(self, question: str, filters=None, top_k=None) -> list[Source]:
        FakeRagService.last_question = question
        return [
            Source(
                doc_id="BASS-II-report",
                excerpt="Flame spread rate decreases as oxygen concentration drops below 18%.",
                page=4,
            )
        ]


class FakeLLMService:
    # Последний вызов generate: тесты проверяют, что ушло в LLM, а что в поиск
    last_call: dict[str, Any] = {}

    def ping(self) -> bool:
        return True

    def model_state(self) -> tuple[bool | None, int | None]:
        return True, 8192

    loading = False
    runtime_name = "LM Studio"
    runtime = SimpleNamespace(name="LM Studio", address="localhost:1234", controls_context=True)
    config = SimpleNamespace(
        runtime=SimpleNamespace(kind="lmstudio"),
        model=SimpleNamespace(name="test-model", context_length=8192, max_tokens=512),
    )

    def needs_load(self) -> bool:
        return False

    def load_model(self) -> None:
        pass

    def unload_model(self) -> None:
        pass

    def search_query(self, question: str) -> str:
        # Как настоящий: переводится только кириллица
        return f"translated: {question}" if any("а" <= c <= "я" for c in question.lower()) else question

    def generate(
        self,
        question: str,
        sources: list[Source],
        language: str | None = None,
        english_question: str | None = None,
    ) -> str:
        FakeLLMService.last_call = {
            "question": question,
            "language": language,
            "english_question": english_question,
        }
        return "Скорость распространения пламени падает ниже 18% O2 [BASS-II-report, стр. 4]."


    # Включается тестом, чтобы проверить ошибку посреди потока
    fail_midstream = False

    def generate_stream(
        self,
        question: str,
        sources: list[Source],
        language: str | None = None,
        english_question: str | None = None,
    ):
        FakeLLMService.last_call = {
            "question": question,
            "language": language,
            "english_question": english_question,
        }
        yield {"type": "stage", "stage": "answering"}
        yield {"type": "delta", "text": "Скорость падает "}
        if FakeLLMService.fail_midstream:
            raise RuntimeError("LM Studio down")
        yield {"type": "delta", "text": "ниже 18% O2."}


class FakeMLService:
    def is_ready(self) -> bool:
        return True

    def predict(self, parameters: dict[str, Any]) -> PredictResponse:
        return PredictResponse(
            risk_score=0.73,
            cluster=2,
            chart_data=ChartData(x=[0.18, 0.21], y=[0.4, 0.73]),
            is_heuristic=False,
        )

    def predict_batch(self, rows: list[dict[str, Any]]) -> BatchResponse:
        return BatchResponse(
            target="burn_rate_mm2s",
            total=len(rows),
            failed=0,
            rows=[
                BatchRow(row=i, predicted_value=0.5, risk_score=0.4)
                for i, _ in enumerate(rows, start=1)
            ],
        )


class FakeDashboardService:
    """Заглушка: тесты не должны зависеть от наличия data/ и обученной модели."""

    def build(self) -> DashboardResponse:
        return DashboardResponse(
            model=ModelInfo(
                task="regression",
                target="burn_rate_mm2s",
                units="mm^2/s",
                target_range=[0.05, 1.06],
                metrics={"r2": 0.65, "mae": 0.055},
                feature_importance={"oxygen_level": 0.35},
                features=["oxygen_level"],
                trained=True,
            ),
            dataset=DatasetInfo(
                name="FLEX",
                source="test source",
                rows=1,
                experiments=[
                    ExperimentPoint(
                        test="FLEX-001", fuel="methanol", oxygen_level=0.21,
                        burn_rate_mm2s=0.52, test_end="disruption",
                    )
                ],
            ),
            corpus=CorpusInfo(
                chunks=3, documents=["doc.pdf"],
                embedding_model="paraphrase-multilingual-MiniLM-L12-v2",
            ),
        )


@pytest.fixture
def client() -> TestClient:
    app.dependency_overrides[get_rag_service] = FakeRagService
    app.dependency_overrides[get_llm_service] = FakeLLMService
    app.dependency_overrides[get_ml_service] = FakeMLService
    app.dependency_overrides[get_dashboard_service] = FakeDashboardService
    # С адреса этой машины ключ не нужен; без client= хост был бы «testclient»
    with TestClient(app, client=("127.0.0.1", 50000)) as test_client:
        yield test_client
    app.dependency_overrides.clear()
