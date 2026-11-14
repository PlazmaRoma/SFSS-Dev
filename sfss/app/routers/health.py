from fastapi import APIRouter, Depends

from app.dependencies import get_llm_service, get_rag_service
from app.models.schemas import HealthResponse
from app.services.llm_service import LLMService
from app.services.rag_service import RagService

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(
    rag: RagService = Depends(get_rag_service),
    llm: LLMService = Depends(get_llm_service),
) -> HealthResponse:
    chroma_ok = rag.ping()
    lm_ok = llm.ping()
    loaded, context_length = llm.model_state() if lm_ok else (None, None)
    return HealthResponse(
        status="ok" if (chroma_ok and lm_ok) else "degraded",
        chroma=chroma_ok,
        lm_studio=lm_ok,
        runtime=llm.config.runtime.kind,
        runtime_name=llm.runtime.name,
        runtime_address=llm.runtime.address,
        model=llm.config.model.name,
        indexed_documents=rag.count() if chroma_ok else None,
        model_loaded=loaded,
        model_context_length=context_length,
        model_context_limit=llm.config.model.context_length if llm.runtime.controls_context else None,
        model_loading=llm.loading,
    )
