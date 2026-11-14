"""POST /ingest — служебная переиндексация data/raw (не для фронта)."""

from fastapi import APIRouter, Depends

from app.dependencies import get_ingest_service
from app.models.schemas import IngestRequest, IngestResponse
from app.services.ingest_service import IngestService

router = APIRouter(tags=["admin"])


@router.post("/ingest", response_model=IngestResponse)
def ingest(
    payload: IngestRequest,
    service: IngestService = Depends(get_ingest_service),
) -> IngestResponse:
    return service.run(force=payload.force)
