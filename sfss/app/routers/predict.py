"""POST /predict — скоринг риска и кластер на sklearn-моделях."""

import csv
import io
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.config import Settings, get_settings
from app.dependencies import get_ml_service
from app.models.schemas import BatchResponse, PredictRequest, PredictResponse
from app.services.ml_service import MLService, ModelNotTrainedError

router = APIRouter(tags=["ml"])


@router.post("/predict", response_model=PredictResponse)
def predict(
    payload: PredictRequest,
    ml: MLService = Depends(get_ml_service),
) -> PredictResponse:
    try:
        return ml.predict(payload.parameters)
    except ModelNotTrainedError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


def parse_csv(body: bytes) -> list[dict[str, Any]]:
    """CSV → строки условий. Колонки называются как признаки модели.

    Пустая ячейка значит «не задано»: подставится значение по умолчанию.
    """
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("CSV must be UTF-8") from exc
    rows = []
    for record in csv.DictReader(io.StringIO(text)):
        # Ячейки сверх заголовка csv кладёт под ключ None
        if None in record:
            rows.append({"extra_cells": record[None]})
            continue
        rows.append(
            {key.strip(): value.strip() for key, value in record.items() if value and value.strip()}
        )
    return rows


def parse_rows(content_type: str, body: bytes) -> list[dict[str, Any]]:
    kind = content_type.split(";")[0].strip().lower()
    if kind == "text/csv":
        return parse_csv(body)
    if kind == "application/json":
        try:
            payload = json.loads(body)
        except ValueError as exc:
            raise ValueError(f"Invalid JSON: {exc}") from exc
        rows = payload.get("rows") if isinstance(payload, dict) else None
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ValueError('Expected JSON like {"rows": [{"oxygen_level": 0.3}]}')
        return rows
    raise ValueError("Content-Type must be application/json or text/csv")


@router.post(
    "/predict/batch",
    response_model=BatchResponse,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/json": {
                    "example": {"rows": [{"oxygen_level": 0.30, "n2": 0.70}, {"he": 0.2, "n2": 0.59}]}
                },
                "text/csv": {"example": "oxygen_level,n2,pressure_mmhg\n0.30,0.70,424\n"},
            },
        }
    },
)
async def predict_batch(
    request: Request,
    ml: MLService = Depends(get_ml_service),
    settings: Settings = Depends(get_settings),
) -> BatchResponse:
    """Много условий одним запросом: JSON или CSV.

    Плохая строка получает поле error и не мешает остальным.
    """
    try:
        rows = parse_rows(request.headers.get("content-type", ""), await request.body())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    if len(rows) > settings.max_batch_rows:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Too many rows: {len(rows)}, the limit is {settings.max_batch_rows}",
        )
    try:
        return await run_in_threadpool(ml.predict_batch, rows)
    except ModelNotTrainedError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
