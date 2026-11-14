"""GET /dashboard — всё, что фронт рисует при загрузке страницы."""

from fastapi import APIRouter, Depends

from app.dependencies import get_dashboard_service
from app.models.schemas import DashboardResponse
from app.services.dashboard_service import DashboardService

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardResponse)
def dashboard(
    service: DashboardService = Depends(get_dashboard_service),
) -> DashboardResponse:
    return service.build()
