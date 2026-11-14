import json
import logging
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.dependencies import get_llm_service, get_rag_service
from app.models.schemas import QueryRequest, QueryResponse
from app.services.llm_service import LLMService, ModelLoadError
from app.services.rag_service import RagService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rag"])


@router.post("/query", response_model=QueryResponse)
def query(
    payload: QueryRequest,
    rag: RagService = Depends(get_rag_service),
    llm: LLMService = Depends(get_llm_service),
) -> QueryResponse:
    if llm.needs_load():
        try:
            llm.load_model()
        except ModelLoadError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    search_text = llm.search_query(payload.question)
    sources = rag.retrieve(search_text, filters=payload.filters)

    try:
        answer = llm.generate(
            payload.question,
            sources,
            language=payload.language,
            english_question=search_text if search_text != payload.question else None,
        )
    except Exception as exc:
        logger.exception("Request to %s failed", llm.runtime_name)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{llm.runtime_name} is unreachable or returned an error: {exc}",
        ) from exc

    return QueryResponse(
        answer=answer,
        sources=sources,
        search_query=search_text if search_text != payload.question else None,
    )


@router.post("/query/stream")
def query_stream(
    payload: QueryRequest,
    rag: RagService = Depends(get_rag_service),
    llm: LLMService = Depends(get_llm_service),
) -> StreamingResponse:
    """Streamed answer: one JSON line per event.

    sources: found chunks, right after search; stage: what is happening now
    (loading, searching, answering, translating); delta: the next piece of text;
    done: the whole answer; error: the model did not load or the runtime failed
    mid-answer. Errors arrive as an event, not as 503: the answer has already started."""

    def events() -> Iterator[str]:
        if llm.needs_load():
            yield _line({"type": "stage", "stage": "loading"})
            try:
                llm.load_model()
            except ModelLoadError as exc:
                yield _line({"type": "error", "detail": str(exc)})
                return
            yield _line({"type": "stage", "stage": "searching"})
        search_text = llm.search_query(payload.question)
        sources = rag.retrieve(search_text, filters=payload.filters)
        translated = search_text if search_text != payload.question else None
        yield _line({
            "type": "sources",
            "sources": [s.model_dump() for s in sources],
            "search_query": translated,
        })
        parts: list[str] = []
        try:
            for event in llm.generate_stream(
                payload.question, sources, language=payload.language, english_question=translated
            ):
                if event["type"] == "delta":
                    parts.append(event["text"])
                yield _line(event)
        except Exception as exc:
            logger.exception("Request to %s failed", llm.runtime_name)
            yield _line({"type": "error", "detail": f"{llm.runtime_name} is unreachable or returned an error: {exc}"})
            return
        yield _line({"type": "done", "answer": "".join(parts).strip()})

    return StreamingResponse(events(), media_type="application/x-ndjson")


def _line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"
