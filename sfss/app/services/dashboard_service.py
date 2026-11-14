"""Сводка для дашборда: датасет, качество модели и состав корпуса.

Собирает в один ответ то, что фронт показывает при загрузке страницы.
Отдельный эндпоинт нужен, потому что `/query` отвечает десятки секунд и
вешать на него отрисовку страницы нельзя: интерактив даёт мгновенный
`/predict`, а LLM вызывается только по кнопке.

Ничего не считает на лету — метрики и важность признаков берутся из
артефакта модели, куда их кладёт `scripts/train_model.py`. Зашивать их
сюда нельзя: после переобучения они бы соврали.
"""

import logging

import pandas as pd

from app.config import Settings, get_settings
from app.models.schemas import (
    CorpusInfo,
    DashboardResponse,
    DatasetInfo,
    ExperimentPoint,
    ModelInfo,
)
from app.services.ml_service import MLService
from app.services.rag_service import RagService

logger = logging.getLogger(__name__)

DATASET_FILE = "flex.csv"
# Значения, уходящие в JSON, держим в ASCII: кириллица здесь — данные для
# чужого кода, а не текст для человека. Фронт сам решает, как их отрисовать
# и на каком языке подписать.
DATASET_SOURCE = (
    "FLEX (Flame Extinguishment Experiment), ISS - test matrix from report "
    "NASA/TP-2015-216046, pages 26-34"
)
# Единицы целевых величин: числа без единиц на дашборде нечитаемы.
# Запись в ASCII: 'mm^2/s' вместо 'мм²/с' — надстрочный знак ломается при
# копировании, а кириллическая 'с' неотличима от латинской 'c' при сравнении.
TARGET_UNITS = {
    "burn_rate_mm2s": "mm^2/s",
    "d_extinction_mm": "mm",
    "burn_time_s": "s",
}
POINT_COLUMNS = [
    "test", "fuel", "oxygen_level", "pressure_mmhg",
    "d_initial_mm", "burn_rate_mm2s", "d_extinction_mm", "test_end",
]


class DashboardService:
    def __init__(
        self,
        rag: RagService,
        ml: MLService,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.rag = rag
        self.ml = ml

    # --- модель ----------------------------------------------------------

    def model_info(self) -> ModelInfo:
        if not self.ml.is_ready():
            return ModelInfo(
                task="unknown", target="unknown", trained=False,
                metrics={}, feature_importance={}, features=[],
            )
        self.ml._load()
        bundle = self.ml._bundle or {}
        target = bundle.get("target") or "unknown"
        target_range = bundle.get("target_range")
        return ModelInfo(
            task=bundle.get("task") or "unknown",
            target=target,
            units=TARGET_UNITS.get(target),
            target_range=list(target_range) if target_range else None,
            metrics=bundle.get("metrics") or {},
            feature_importance=bundle.get("feature_importance") or {},
            features=bundle.get("features") or [],
            defaults=self.ml.defaults_for(bundle.get("features") or []),
            is_heuristic=bool(bundle.get("is_heuristic", False)),
            trained=True,
        )

    # --- датасет ---------------------------------------------------------

    def dataset_info(self) -> DatasetInfo:
        path = self.settings.processed_dir / DATASET_FILE
        if not path.exists():
            logger.warning("Нет %s — соберите его scripts/build_flex_dataset.py", path)
            return DatasetInfo(name="FLEX", source=DATASET_SOURCE, rows=0)

        df = pd.read_csv(path)
        available = [c for c in POINT_COLUMNS if c in df.columns]
        frame = df[available].where(pd.notna(df[available]), None)
        points = [ExperimentPoint(**row) for row in frame.to_dict("records")]
        return DatasetInfo(
            name="FLEX", source=DATASET_SOURCE, rows=len(df), experiments=points
        )

    # --- корпус ----------------------------------------------------------

    def corpus_info(self) -> CorpusInfo:
        try:
            chunks = self.rag.count()
            stored = self.rag.collection.get(include=["metadatas"])
            documents = sorted(
                {m.get("source") for m in stored.get("metadatas", []) if m and m.get("source")}
            )
        except Exception as exc:
            logger.warning("Корпус недоступен: %s", exc)
            chunks, documents = 0, []
        return CorpusInfo(
            chunks=chunks,
            documents=documents,
            embedding_model=self.settings.embedding_model,
        )

    def build(self) -> DashboardResponse:
        return DashboardResponse(
            model=self.model_info(),
            dataset=self.dataset_info(),
            corpus=self.corpus_info(),
        )
