"""POST /query — retrieval из ChromaDB + генерация ответа нейросетью.

POST /query/stream — то же, но ответ приходит потоком (NDJSON).
"""

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
    # Раньше перевода вопроса: он первым обратится к модели, и LM Studio поднял
    # бы её сам, с контекстом 262 144
    if llm.needs_load():
        try:
            llm.load_model()
        except ModelLoadError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    # Ищем по переводу, а отвечаем на исходный вопрос: см. translate_queries
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
        logger.exception("Ошибка обращения к %s", llm.runtime_name)
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
    """Ответ потоком: одна строка JSON на событие.

    sources — найденные фрагменты, сразу после поиска; stage — что происходит
    сейчас (loading, searching, answering, translating); delta — следующий кусок
    текста; done — весь ответ целиком; error — модель не загрузилась или рантайм
    упал посреди ответа. Ошибка приходит событием, а не кодом 503: к этому моменту
    ответ уже начат.
    """

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
            logger.exception("Ошибка обращения к %s", llm.runtime_name)
            yield _line({"type": "error", "detail": f"{llm.runtime_name} is unreachable or returned an error: {exc}"})
            return
        yield _line({"type": "done", "answer": "".join(parts).strip()})

    return StreamingResponse(events(), media_type="application/x-ndjson")


def _line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"
