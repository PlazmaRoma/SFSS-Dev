"""Обучение модели fiery: RandomForest-скоринг риска + KMeans-кластеризация.

Запуск:
    python scripts/train_model.py --dataset data/processed/bass_ii.csv \
        --target outcome --group sample

Если целевой колонки в датасете нет, модель риска НЕ обучается: сохраняется
эвристика с флагом is_heuristic=True, чтобы результат не выдавался за
предсказание модели (п. 5.3 ТЗ).

Как считается качество
----------------------
Наивная схема «один случайный сплит + accuracy» на этих данных врёт, поэтому:

* **Групповая кросс-валидация.** Один и тот же образец жгли в нескольких
  тестах (T28a и T28b — один кусок ткани). При случайном разбиении такие
  строки расходятся по обучению и тесту, и модель «угадывает» по памяти.
  `--group sample` кладёт все строки одного образца в один фолд.
* **Стратификация.** Классы перекошены (73 против 6), при случайном сплите
  редкий класс может целиком не попасть в тест.
* **Baseline большинства.** Константный ответ самым частым классом даёт
  ~63 %. Accuracy ниже этого означает, что модель хуже заглушки.
* **Per-class метрики и матрица ошибок** вместо общей accuracy: интересна
  способность ловить редкие исходы, а не средняя правота.

Пропуски в признаках заполняются медианой внутри пайплайна: у плёнки нет
диаметра, у стержня нет толщины, и это нормально, но KMeans без импьютера
на таких данных падает.
"""

import argparse
import logging
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    mean_absolute_error,
    r2_score,
    root_mean_squared_error,
)
from sklearn.model_selection import (
    GroupKFold,
    KFold,
    StratifiedGroupKFold,
    StratifiedKFold,
    cross_val_predict,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.services.ml_service import CLUSTER_MODEL_FILE, RISK_MODEL_FILE  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


class HeuristicRiskModel:
    """Заглушка-эвристика на случай отсутствия разметки.

    Линейная комбинация нормированных признаков — осознанно НЕ выдаётся
    за обученную модель: MLService проставит is_heuristic=True.
    """

    def __init__(self, features: list[str]) -> None:
        self.features = features

    def predict(self, x):
        arr = np.asarray(x, dtype=float)
        scale = np.nanmax(np.abs(arr)) or 1.0
        return np.clip(np.nanmean(arr, axis=1) / scale, 0.0, 1.0)


def load_dataset(path: Path) -> pd.DataFrame:
    return pd.read_csv(path)


def make_estimator(task: str) -> object:
    """Пайплайн под задачу. Импьютер обязателен: у плёнки нет диаметра,
    у стержня нет толщины, а KMeans и StandardScaler пропусков не терпят."""
    if task == "regression":
        head = RandomForestRegressor(
            n_estimators=300, min_samples_leaf=2, random_state=42
        )
    else:
        head = RandomForestClassifier(
            n_estimators=300,
            min_samples_leaf=2,          # мало строк на признак — сдерживаем переобучение
            class_weight="balanced",     # классы перекошены
            random_state=42,
        )
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), head)


def make_classifier() -> object:
    """Совместимость с прежним именем."""
    return make_estimator("classification")


def choose_splitter(y: pd.Series, groups: pd.Series | None, folds: int, task: str = "classification"):
    """Групповой сплиттер, если задана колонка групп.

    Для регрессии стратификация не применима — берётся GroupKFold/KFold.
    """
    if task == "regression":
        if groups is not None:
            folds = min(folds, groups.nunique())
            return GroupKFold(n_splits=folds), folds
        return KFold(n_splits=folds, shuffle=True, random_state=42), folds

    smallest = y.value_counts().min()
    if smallest < folds:
        logger.warning(
            "В наименьшем классе %d строк — фолдов уменьшено до %d", smallest, smallest
        )
        folds = max(2, smallest)
    if groups is not None:
        return StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=42), folds
    return StratifiedKFold(n_splits=folds, shuffle=True, random_state=42), folds


def evaluate_regression(x: pd.DataFrame, y: pd.Series, groups: pd.Series | None,
                        folds: int, target: str) -> dict:
    """Out-of-fold предсказания и сравнение с константным ответом (средним).

    R2 считается относительно среднего по определению, поэтому R2 <= 0 прямо
    означает «модель не лучше константы».
    """
    splitter, folds = choose_splitter(y, groups, folds, task="regression")
    kind = "групповая" if groups is not None else "обычная"
    logger.info("Кросс-валидация: %s, фолдов %d", kind, folds)

    predicted = cross_val_predict(
        make_estimator("regression"), x, y, cv=splitter, groups=groups, n_jobs=-1
    )
    baseline = np.full_like(y.to_numpy(), y.mean(), dtype=float)

    print()
    print(f"Цель: {target} | строк {len(y)} | разброс {y.min():.3g}-{y.max():.3g}, "
          f"среднее {y.mean():.3g}")
    print()
    print(f"{'метрика':>8} {'модель':>10} {'константа':>12}")
    print(f"{'MAE':>8} {mean_absolute_error(y, predicted):>10.3f} "
          f"{mean_absolute_error(y, baseline):>12.3f}")
    print(f"{'RMSE':>8} {root_mean_squared_error(y, predicted):>10.3f} "
          f"{root_mean_squared_error(y, baseline):>12.3f}")
    r2 = r2_score(y, predicted)
    print(f"{'R2':>8} {r2:>10.3f} {0.0:>12.3f}")
    print()
    verdict = "ЛУЧШЕ" if r2 > 0 else "НЕ лучше"
    print(f"Модель {verdict} константного ответа (R2 {'>' if r2 > 0 else '<='} 0).")
    print()
    return {
        "r2": round(float(r2), 4),
        "mae": round(float(mean_absolute_error(y, predicted)), 4),
        "rmse": round(float(root_mean_squared_error(y, predicted)), 4),
        "mae_baseline": round(float(mean_absolute_error(y, baseline)), 4),
        "rows": int(len(y)),
        "folds": int(folds),
    }


def evaluate(x: pd.DataFrame, y: pd.Series, groups: pd.Series | None, folds: int) -> dict:
    """Out-of-fold предсказания по всей выборке, затем один общий отчёт."""
    splitter, folds = choose_splitter(y, groups, folds)
    kind = "групповая" if groups is not None else "обычная"
    logger.info("Кросс-валидация: %s стратифицированная, фолдов %d", kind, folds)

    predicted = cross_val_predict(
        make_classifier(), x, y, cv=splitter, groups=groups, n_jobs=-1
    )

    majority = y.value_counts(normalize=True).max()
    accuracy = float((predicted == y.to_numpy()).mean())

    print()
    print(f"Baseline (константа самым частым классом): {majority:.1%}")
    print(f"Accuracy out-of-fold:                      {accuracy:.1%}")
    verdict = "лучше" if accuracy > majority else "НЕ лучше"
    print(f"Модель {verdict} константного ответа.")
    print()
    print("Per-class метрики (out-of-fold):")
    print(classification_report(y, predicted, zero_division=0))
    labels = sorted(y.unique())
    print("Матрица ошибок (строки — факт, столбцы — предсказание):")
    print(pd.DataFrame(
        confusion_matrix(y, predicted, labels=labels), index=labels, columns=labels
    ).to_string())
    print()
    return {
        "accuracy": round(accuracy, 4),
        "baseline": round(float(majority), 4),
        "rows": int(len(y)),
        "folds": int(folds),
    }


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Обучение модели fiery")
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--target", default=None, help="Колонка целевой переменной")
    parser.add_argument(
        "--group",
        default=None,
        help="Колонка групп для кросс-валидации (например sample) — строки одной "
             "группы не расходятся между обучением и тестом",
    )
    parser.add_argument(
        "--drop-values",
        nargs="*",
        default=["unknown"],
        help="Значения целевой колонки, которые не являются классом и выбрасываются",
    )
    parser.add_argument(
        "--task", choices=("auto", "classification", "regression"), default="auto",
        help="auto — по типу целевой колонки",
    )
    parser.add_argument(
        "--exclude", nargs="*", default=[],
        help="Колонки, которые нельзя брать в признаки: измеренные результаты опыта "
             "(утечка целевой переменной)",
    )
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--n-clusters", type=int, default=4)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Только оценка, без сохранения артефактов",
    )
    args = parser.parse_args()

    df = load_dataset(args.dataset)
    logger.info("Загружено строк: %d", len(df))

    if args.target and args.target in df.columns:
        before = len(df)
        df = df[~df[args.target].isin(args.drop_values)].copy()
        if len(df) < before:
            logger.info(
                "Отброшено %d строк со значениями %s в целевой колонке",
                before - len(df), args.drop_values,
            )

        task = args.task
        if task == "auto":
            task = "regression" if pd.api.types.is_numeric_dtype(df[args.target]) else "classification"

        # строки без целевого значения обучать не на чем
        before = len(df)
        df = df[df[args.target].notna()].copy()
        if len(df) < before:
            logger.info("Отброшено %d строк без значения цели", before - len(df))

        excluded = set(args.exclude) | {args.target}
        features = [c for c in df.select_dtypes("number").columns if c not in excluded]
        if args.exclude:
            logger.info("Исключено из признаков: %s", sorted(set(args.exclude)))
        x, y = df[features], df[args.target]
        groups = df[args.group] if args.group and args.group in df.columns else None
        if args.group and groups is None:
            logger.warning("Колонки групп '%s' нет — оценка без группировки", args.group)

        logger.info("Задача: %s | строк: %d | признаков: %d", task, len(df), len(features))
        if groups is not None:
            logger.info("Групп (%s): %d", args.group, groups.nunique())

        if task == "regression":
            metrics = evaluate_regression(x, y, groups, args.folds, args.target)
        else:
            metrics = evaluate(x, y, groups, args.folds)

        # финальная модель обучается на всех данных — оценка уже получена выше
        model = make_estimator(task)
        model.fit(x, y)
        # важность признаков нужна дашборду; берём у самого леса, последнего
        # шага пайплайна, и раскладываем по именам в том же порядке
        head = model[-1]
        importance = (
            {f: round(float(v), 4) for f, v in zip(features, head.feature_importances_)}
            if hasattr(head, "feature_importances_") else {}
        )
        bundle = {
            "model": model,
            "features": features,
            "is_heuristic": False,
            "task": task,
            "target": args.target,
            # метрики и важность сохраняются рядом с моделью намеренно: если
            # зашить их в эндпоинт, после переобучения он начнёт врать
            "metrics": metrics,
            "feature_importance": importance,
            # границы нужны, чтобы перевести предсказанную величину в risk_score 0..1
            "target_range": (float(y.min()), float(y.max())) if task == "regression" else None,
        }
    else:
        features = list(df.select_dtypes("number").columns)
        logger.warning(
            "Целевая переменная не задана/не найдена — сохраняю ЭВРИСТИКУ, не модель"
        )
        bundle = {
            "model": HeuristicRiskModel(features),
            "features": features,
            "is_heuristic": True,
        }

    if args.dry_run:
        logger.info("--dry-run: артефакты не сохранены")
        return

    settings.models_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, settings.models_dir / RISK_MODEL_FILE)

    kmeans = make_pipeline(
        SimpleImputer(strategy="median"),
        StandardScaler(),
        KMeans(n_clusters=args.n_clusters, n_init=10, random_state=42),
    )
    kmeans.fit(df[features])
    joblib.dump(kmeans, settings.models_dir / CLUSTER_MODEL_FILE)

    logger.info("Артефакты сохранены в %s", settings.models_dir)
    logger.info("Признаки (порядок важен для /predict): %s", features)


if __name__ == "__main__":
    main()
