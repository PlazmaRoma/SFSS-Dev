"""Ленивые синглтоны сервисов для FastAPI Depends.

Модели эмбеддингов и joblib-артефакты грузятся один раз на процесс;
в тестах провайдеры подменяются через app.dependency_overrides.
"""

from functools import lru_cache

from app.services.dashboard_service import DashboardService
from app.services.document_service import DocumentService
from app.services.ingest_service import IngestService
from app.services.llm_service import LLMService
from app.services.ml_service import MLService
from app.services.rag_service import RagService


@lru_cache
def get_rag_service() -> RagService:
    return RagService()


@lru_cache
def get_llm_service() -> LLMService:
    return LLMService()


@lru_cache
def get_ml_service() -> MLService:
    return MLService()


@lru_cache
def get_ingest_service() -> IngestService:
    return IngestService(rag=get_rag_service())


@lru_cache
def get_dashboard_service() -> DashboardService:
    return DashboardService(rag=get_rag_service(), ml=get_ml_service())


@lru_cache
def get_document_service() -> DocumentService:
    return DocumentService(rag=get_rag_service(), ingest=get_ingest_service())
