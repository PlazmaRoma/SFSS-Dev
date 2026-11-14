"""Точка входа FastAPI: запуск — uvicorn app.main:app --reload"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import BASE_DIR, get_settings
from app.dependencies import get_ml_service, get_rag_service
from app.routers import dashboard, documents, health, ingest, llm, predict, query
from app.security import require_api_key

logging.basicConfig(level=logging.INFO)

settings = get_settings()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Прогрев тяжёлых зависимостей до приёма первого запроса.

    Модель поиска грузится лениво и стоит около полутора секунд. Без прогрева
    эту задержку платил первый же запрос, и фронт, опрашивающий /health,
    принимал сервер за зависший. С прогревом дольше стартует uvicorn, зато
    отвечает он честно: раз порт открыт — сервис готов.
    """
    if settings.warmup_on_startup:
        started = time.perf_counter()
        try:
            get_rag_service().keyword_index()
            logger.info("Прогрев: индекс поиска по словам построен")
            get_rag_service().warm_up()
            logger.info("Прогрев: модель поиска готова")
        except Exception as exc:
            # Без модели поиска расчёт и Площадка работают, вопросы — нет
            logger.warning("Поиск по отчётам не готов: %s", exc)
        try:
            get_ml_service()._load()
            logger.info("Прогрев: модель fiery загружена")
        except Exception as exc:
            # Отсутствие обученной модели — не повод не поднимать сервис:
            # /query и /health работают без неё, /predict честно отдаст 503.
            logger.warning("Модель fiery недоступна: %s", exc)
        logger.info("Прогрев занял %.1f с", time.perf_counter() - started)
    yield


app = FastAPI(
    lifespan=lifespan,
    title="SFSS API",
    description="RAG + ML по данным NASA PSI о горении в невесомости",
    version="0.2.0",
)

# Фронт (в т.ч. десктоп-обёртка) ходит с другого origin
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

guarded = [Depends(require_api_key)]
for module in (health, dashboard, query, predict, ingest, documents, llm):
    app.include_router(module.router, prefix="/v1", dependencies=guarded)
# Старые пути без версии: на них живут Площадка и снятые фикстуры фронта
for module in (health, dashboard, query, predict, ingest):
    app.include_router(module.router, include_in_schema=False, dependencies=guarded)

PLAYGROUND = BASE_DIR / "app" / "static" / "playground" / "index.html"


@app.get("/playground", include_in_schema=False, dependencies=guarded)
def playground() -> FileResponse:
    """Площадка: старая программа, идёт в комплекте. Открывается: sfss playground."""
    if not PLAYGROUND.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playground is not built: run sfss/scripts/update_playground.sh",
        )
    return FileResponse(PLAYGROUND, media_type="text/html")
