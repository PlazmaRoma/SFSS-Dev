"""Инференс модели fiery: скоринг риска и кластеризация экспериментов."""

import logging
import math
from typing import Any

import joblib
import numpy as np
import pandas as pd

from app.config import Settings, get_settings
from app.models.schemas import BatchResponse, BatchRow, ChartData, PredictResponse

logger = logging.getLogger(__name__)

# Модель скоринга риска называется fiery
MODEL_NAME = "fiery"
RISK_MODEL_FILE = f"{MODEL_NAME}.joblib"
CLUSTER_MODEL_FILE = f"{MODEL_NAME}_clusters.joblib"

# Значения по умолчанию, чтобы фронт присылал только то, что пользователь
# реально меняет, а не все восемь признаков.
#
# Это стандартная атмосфера на уровне моря, а НЕ медианы обучающей выборки:
# медианы долей газов дают в сумме 0.86, то есть смесь, которой не бывает —
# FLEX намеренно перебирал необычные атмосферы, и покоординатная медиана
# физически бессмысленна. Диаметр капли 3.0 мм близок к медиане выборки (3.01),
# метанол выбран как топливо большинства опытов (151 против 108).
#
# Признак, которого здесь нет, остаётся обязательным: если модель переобучат
# на других колонках, /predict честно потребует их, а не подставит выдумку.
FEATURE_DEFAULTS: dict[str, float] = {
    "pressure_mmhg": 760.0,
    "oxygen_level": 0.21,
    "n2": 0.79,
    "co2": 0.0,
    "he": 0.0,
    "d_initial_mm": 3.0,
    "fuel_heptane": 0.0,
    "fuel_methanol": 1.0,
}

TRAINING_DATASET = "flex.csv"
GASES = ("oxygen_level", "n2", "co2", "he")
# Запас на округление долей в запросе
GAS_SUM_TOLERANCE = 0.01


class ModelNotTrainedError(RuntimeError):
    """Артефакты не найдены — сначала нужно запустить scripts/train_model.py."""


class MLService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._bundle: dict[str, Any] | None = None
        self._cluster_model: Any = None
        self._ranges: dict[str, tuple[float, float]] | None = None

    def _load(self) -> None:
        """Ленивая загрузка артефактов joblib при первом обращении."""
        if self._bundle is not None:
            return

        risk_path = self.settings.models_dir / RISK_MODEL_FILE
        if not risk_path.exists():
            raise ModelNotTrainedError(
                f"Model artifact not found: {risk_path}. Run: python scripts/train_model.py"
            )

        # bundle: {"model": ..., "features": [...], "is_heuristic": bool}
        self._bundle = joblib.load(risk_path)

        cluster_path = self.settings.models_dir / CLUSTER_MODEL_FILE
        if cluster_path.exists():
            self._cluster_model = joblib.load(cluster_path)

    def is_ready(self) -> bool:
        return (self.settings.models_dir / RISK_MODEL_FILE).exists()

    def _vectorize(self, parameters: dict[str, Any]) -> pd.DataFrame:
        """Приводит словарь параметров к строке DataFrame в порядке features.

        Именно DataFrame, а не numpy: модели обучаются на именованных
        колонках, и без имён sklearn предупреждает о несовпадении схемы.
        """
        assert self._bundle is not None
        features: list[str] = self._bundle["features"]
        return pd.DataFrame(
            [[parameters[f] for f in features]], columns=features, dtype=float
        )

    def resolve(self, parameters: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """Дополняет запрос значениями по умолчанию.

        Возвращает полный набор признаков и список тех, что были подставлены:
        фронт должен показать пользователю, что часть условий он не задавал.

        Неизвестный ключ — ошибка, а не повод его проигнорировать. Опечатка
        вроде `oxigen_level` иначе молча заменилась бы значением по умолчанию,
        и пользователь получил бы правдоподобное, но неверное число.
        """
        assert self._bundle is not None
        features: list[str] = self._bundle["features"]

        unknown = sorted(set(parameters) - set(features))
        if unknown:
            raise ValueError(
                f"Unknown parameters: {unknown}. Expected any of: {features}"
            )

        resolved = dict(parameters)
        applied: list[str] = []
        missing: list[str] = []
        for feature in features:
            if feature in resolved:
                continue
            if feature in FEATURE_DEFAULTS:
                resolved[feature] = FEATURE_DEFAULTS[feature]
                applied.append(feature)
            else:
                missing.append(feature)
        if missing:
            raise ValueError(f"Missing required parameters without defaults: {missing}")
        return resolved, applied

    @staticmethod
    def defaults_for(features: list[str]) -> dict[str, float]:
        """Значения по умолчанию для признаков модели — фронту для инициализации."""
        return {f: FEATURE_DEFAULTS[f] for f in features if f in FEATURE_DEFAULTS}

    def predict(self, parameters: dict[str, Any]) -> PredictResponse:
        self._load()
        assert self._bundle is not None

        resolved, applied = self.resolve(parameters)
        x = self._vectorize(resolved)
        risk_score, predicted = self._score(x)

        cluster = None
        if self._cluster_model is not None:
            cluster = int(self._cluster_model.predict(x)[0])

        return PredictResponse(
            risk_score=risk_score,
            predicted_value=predicted,
            target=self._bundle.get("target"),
            cluster=cluster,
            chart_data=self._build_chart(resolved),
            defaults_applied=applied,
            is_heuristic=bool(self._bundle.get("is_heuristic", False)),
            warnings=self.warnings_for(resolved),
        )

    def predict_batch(self, rows: list[dict[str, Any]]) -> BatchResponse:
        """Пакетный расчёт: плохая строка получает error, остальные считаются.

        Модель вызывается один раз на все строки, а не на каждую: лес деревьев
        на одной строке стоит миллисекунды, и 10 000 строк шли бы минутами.
        """
        self._load()
        assert self._bundle is not None
        features: list[str] = self._bundle["features"]

        results: list[BatchRow] = []
        good: list[tuple[BatchRow, dict[str, Any]]] = []
        for number, parameters in enumerate(rows, start=1):
            try:
                resolved, applied = self.resolve(_numeric(parameters))
            except ValueError as exc:
                results.append(BatchRow(row=number, error=str(exc)))
                continue
            row = BatchRow(
                row=number, defaults_applied=applied, warnings=self.warnings_for(resolved)
            )
            results.append(row)
            good.append((row, resolved))

        if good:
            x = pd.DataFrame(
                [[resolved[f] for f in features] for _, resolved in good],
                columns=features,
                dtype=float,
            )
            clusters = (
                self._cluster_model.predict(x) if self._cluster_model is not None else None
            )
            for i, ((row, _), (risk, value)) in enumerate(zip(good, self._score_frame(x))):
                row.risk_score = risk
                row.predicted_value = value
                row.cluster = int(clusters[i]) if clusters is not None else None

        return BatchResponse(
            target=self._bundle.get("target"),
            is_heuristic=bool(self._bundle.get("is_heuristic", False)),
            total=len(results),
            failed=sum(r.error is not None for r in results),
            rows=results,
        )

    def _feature_ranges(self) -> dict[str, tuple[float, float]]:
        """Диапазоны признаков в обучающей выборке; без датасета — пусто."""
        if self._ranges is None:
            path = self.settings.processed_dir / TRAINING_DATASET
            self._ranges = {}
            try:
                frame = pd.read_csv(path)
            except Exception as exc:
                logger.warning("Диапазоны обучения недоступны: %s", exc)
                return self._ranges
            assert self._bundle is not None
            for feature in self._bundle["features"]:
                if feature in frame.columns:
                    self._ranges[feature] = (
                        float(frame[feature].min()), float(frame[feature].max())
                    )
        return self._ranges

    def warnings_for(self, resolved: dict[str, Any]) -> list[str]:
        """Почему этому числу стоит доверять меньше.

        Вне диапазона обучения лес деревьев выходит на плато (кислород выше
        0.34 даёт прямую линию), а сумма газов не из единицы значит смесь,
        которой не бывает: {"oxygen_level": 0.30} с воздушным азотом это 109%.
        Значения считаются всё равно, но человек должен это видеть.
        """
        warnings = []
        for feature, (low, high) in self._feature_ranges().items():
            value = resolved.get(feature)
            if value is not None and not low <= float(value) <= high:
                warnings.append(
                    f"{feature}={float(value):g} is outside the training range {low:g}..{high:g}"
                )
        if all(gas in resolved for gas in GASES):
            total = sum(float(resolved[gas]) for gas in GASES)
            if abs(total - 1.0) > GAS_SUM_TOLERANCE:
                warnings.append(f"gas fractions sum to {total:.3f}, not 1")
        return warnings

    def _score(self, x) -> tuple[float, float | None]:
        return self._score_frame(x)[0]

    def _score_frame(self, x) -> list[tuple[float, float | None]]:
        """Риск в диапазоне 0..1 и, для регрессии, сама величина в её единицах.

        Регрессия предсказывает физическую величину (скорость горения, мм²/с),
        а контракт API требует risk_score от нуля до единицы, поэтому значение
        нормируется по диапазону обучающей выборки. Сам предсказанный результат
        отдаётся рядом в `predicted_value` — без него число 0.73 нечитаемо.
        """
        assert self._bundle is not None
        model = self._bundle["model"]

        if self._bundle.get("task") == "regression":
            low, high = self._bundle.get("target_range") or (0.0, 1.0)
            span = high - low
            scored = []
            for raw in model.predict(x):
                risk = (float(raw) - low) / span if span else 0.0
                scored.append((float(min(max(risk, 0.0), 1.0)), float(raw)))
            return scored

        if hasattr(model, "predict_proba"):
            return [(float(p[-1]), None) for p in model.predict_proba(x)]
        return [(float(v), None) for v in model.predict(x)]

    def _build_chart(self, parameters: dict[str, Any]) -> ChartData:
        """Свип риска по уровню кислорода при остальных параметрах фиксированных."""
        assert self._bundle is not None
        features: list[str] = self._bundle["features"]
        sweep_feature = "oxygen_level"
        if sweep_feature not in features:
            return ChartData()

        xs = np.linspace(0.15, 0.40, 20)
        probes = [dict(parameters) | {sweep_feature: float(value)} for value in xs]
        frame = pd.DataFrame(
            [[probe[f] for f in features] for probe in probes], columns=features, dtype=float
        )
        # Одним вызовом: 20 вызовов леса стоили 0.4 с на каждое движение ползунка.
        # Та же шкала, что у risk_score, иначе график и число разойдутся
        ys = [risk for risk, _ in self._score_frame(frame)]
        return ChartData(x=[float(v) for v in xs], y=ys)


def _numeric(parameters: dict[str, Any]) -> dict[str, float]:
    """Значения строки как числа: CSV приносит текст, а NaN тихо сломал бы лес."""
    numeric = {}
    for name, value in parameters.items():
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{name}: not a number: {value!r}") from None
        if not math.isfinite(number):
            raise ValueError(f"{name}: not a finite number: {value!r}")
        numeric[name] = number
    return numeric
