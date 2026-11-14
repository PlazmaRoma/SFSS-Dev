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
    if settings.warmup_on_startup:
        started = time.perf_counter()
        try:
            get_rag_service().keyword_index()
            logger.info("Warm-up: keyword index built")
            get_rag_service().warm_up()
            logger.info("Warm-up: search model ready")
        except Exception as exc:
            logger.warning("Report search is not ready: %s", exc)
        try:
            get_ml_service()._load()
            logger.info("Warm-up: fiery model loaded")
        except Exception as exc:
            logger.warning("The fiery model is unavailable: %s", exc)
        logger.info("Warm-up took %.1f s", time.perf_counter() - started)
    yield


app = FastAPI(
    lifespan=lifespan,
    title="SFSS API",
    description="Combustion in microgravity from NASA data: burning rate prediction and answers from NASA reports",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

guarded = [Depends(require_api_key)]
for module in (health, dashboard, query, predict, ingest, documents, llm):
    app.include_router(module.router, prefix="/v1", dependencies=guarded)
for module in (health, dashboard, query, predict, ingest):
    app.include_router(module.router, include_in_schema=False, dependencies=guarded)

PLAYGROUND = BASE_DIR / "app" / "static" / "playground" / "index.html"


@app.get("/playground", include_in_schema=False, dependencies=guarded)
def playground() -> FileResponse:
    """SFSS Playground, bundled with the service. Opened by: sfss playground."""
    if not PLAYGROUND.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Playground is not built: run sfss/scripts/update_playground.sh",
        )
    return FileResponse(PLAYGROUND, media_type="text/html")
