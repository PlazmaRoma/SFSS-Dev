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
    def __init__(self, features: list[str]) -> None:
        self.features = features

    def predict(self, x):
        arr = np.asarray(x, dtype=float)
        scale = np.nanmax(np.abs(arr)) or 1.0
        return np.clip(np.nanmean(arr, axis=1) / scale, 0.0, 1.0)


def load_dataset(path: Path) -> pd.DataFrame:
    return pd.read_csv(path)


def make_estimator(task: str) -> object:
    if task == "regression":
        head = RandomForestRegressor(
            n_estimators=300, min_samples_leaf=2, random_state=42
        )
    else:
        head = RandomForestClassifier(
            n_estimators=300,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
        )
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), head)


def make_classifier() -> object:
    return make_estimator("classification")


def choose_splitter(y: pd.Series, groups: pd.Series | None, folds: int, task: str = "classification"):
    if task == "regression":
        if groups is not None:
            folds = min(folds, groups.nunique())
            return GroupKFold(n_splits=folds), folds
        return KFold(n_splits=folds, shuffle=True, random_state=42), folds

    smallest = y.value_counts().min()
    if smallest < folds:
        logger.warning(
            "The smallest class has %d rows: folds reduced to %d", smallest, smallest
        )
        folds = max(2, smallest)
    if groups is not None:
        return StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=42), folds
    return StratifiedKFold(n_splits=folds, shuffle=True, random_state=42), folds


def evaluate_regression(x: pd.DataFrame, y: pd.Series, groups: pd.Series | None,
                        folds: int, target: str) -> dict:
    splitter, folds = choose_splitter(y, groups, folds, task="regression")
    kind = "grouped" if groups is not None else "plain"
    logger.info("Cross-validation: %s, %d folds", kind, folds)

    predicted = cross_val_predict(
        make_estimator("regression"), x, y, cv=splitter, groups=groups, n_jobs=-1
    )
    baseline = np.full_like(y.to_numpy(), y.mean(), dtype=float)

    print()
    print(f"Target: {target} | rows {len(y)} | range {y.min():.3g}-{y.max():.3g}, "
          f"mean {y.mean():.3g}")
    print()
    print(f"{'metric':>8} {'model':>10} {'constant':>12}")
    print(f"{'MAE':>8} {mean_absolute_error(y, predicted):>10.3f} "
          f"{mean_absolute_error(y, baseline):>12.3f}")
    print(f"{'RMSE':>8} {root_mean_squared_error(y, predicted):>10.3f} "
          f"{root_mean_squared_error(y, baseline):>12.3f}")
    r2 = r2_score(y, predicted)
    print(f"{'R2':>8} {r2:>10.3f} {0.0:>12.3f}")
    print()
    verdict = "BETTER than" if r2 > 0 else "NOT better than"
    print(f"The model is {verdict} a constant answer (R2 {'>' if r2 > 0 else '<='} 0).")
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
    splitter, folds = choose_splitter(y, groups, folds)
    kind = "grouped" if groups is not None else "plain"
    logger.info("Cross-validation: %s stratified, %d folds", kind, folds)

    predicted = cross_val_predict(
        make_classifier(), x, y, cv=splitter, groups=groups, n_jobs=-1
    )

    majority = y.value_counts(normalize=True).max()
    accuracy = float((predicted == y.to_numpy()).mean())

    print()
    print(f"Baseline (always the most frequent class): {majority:.1%}")
    print(f"Accuracy out-of-fold:                      {accuracy:.1%}")
    verdict = "better than" if accuracy > majority else "NOT better than"
    print(f"The model is {verdict} a constant answer.")
    print()
    print("Per-class metrics (out-of-fold):")
    print(classification_report(y, predicted, zero_division=0))
    labels = sorted(y.unique())
    print("Confusion matrix (rows: actual, columns: predicted):")
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
    parser = argparse.ArgumentParser(description="Train the fiery model")
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--target", default=None, help="Target column")
    parser.add_argument(
        "--group",
        default=None,
        help="Group column for cross-validation (for example sample): rows of one "
             "group never split between training and test",
    )
    parser.add_argument(
        "--drop-values",
        nargs="*",
        default=["unknown"],
        help="Target values that are not a class and are dropped",
    )
    parser.add_argument(
        "--task", choices=("auto", "classification", "regression"), default="auto",
        help="auto: from the target column type",
    )
    parser.add_argument(
        "--exclude", nargs="*", default=[],
        help="Columns that must not be features: measured experiment results "
             "(target leakage)",
    )
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--n-clusters", type=int, default=4)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Evaluate only, do not save artifacts",
    )
    args = parser.parse_args()

    df = load_dataset(args.dataset)
    logger.info("Rows loaded: %d", len(df))

    if args.target and args.target in df.columns:
        before = len(df)
        df = df[~df[args.target].isin(args.drop_values)].copy()
        if len(df) < before:
            logger.info(
                "Dropped %d rows with %s in the target column",
                before - len(df), args.drop_values,
            )

        task = args.task
        if task == "auto":
            task = "regression" if pd.api.types.is_numeric_dtype(df[args.target]) else "classification"

        before = len(df)
        df = df[df[args.target].notna()].copy()
        if len(df) < before:
            logger.info("Dropped %d rows without a target value", before - len(df))

        excluded = set(args.exclude) | {args.target}
        features = [c for c in df.select_dtypes("number").columns if c not in excluded]
        if args.exclude:
            logger.info("Excluded from features: %s", sorted(set(args.exclude)))
        x, y = df[features], df[args.target]
        groups = df[args.group] if args.group and args.group in df.columns else None
        if args.group and groups is None:
            logger.warning("No group column '%s': evaluating without groups", args.group)

        logger.info("Task: %s | rows: %d | features: %d", task, len(df), len(features))
        if groups is not None:
            logger.info("Groups (%s): %d", args.group, groups.nunique())

        if task == "regression":
            metrics = evaluate_regression(x, y, groups, args.folds, args.target)
        else:
            metrics = evaluate(x, y, groups, args.folds)

        model = make_estimator(task)
        model.fit(x, y)
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
            "metrics": metrics,
            "feature_importance": importance,
            "target_range": (float(y.min()), float(y.max())) if task == "regression" else None,
        }
    else:
        features = list(df.select_dtypes("number").columns)
        logger.warning(
            "No target given or found: saving a HEURISTIC, not a model"
        )
        bundle = {
            "model": HeuristicRiskModel(features),
            "features": features,
            "is_heuristic": True,
        }

    if args.dry_run:
        logger.info("--dry-run: artifacts not saved")
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

    logger.info("Artifacts saved to %s", settings.models_dir)
    logger.info("Features (order matters for /predict): %s", features)


if __name__ == "__main__":
    main()
