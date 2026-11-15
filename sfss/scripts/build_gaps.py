#!/usr/bin/env python3
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "playground/src/shared/fixtures/gaps.json"
PSI_TO_MMHG = 51.715

OXY = [round(0.15 + i * 0.01, 2) for i in range(26)]
PSI = [float(p) for p in range(5, 17)]
DROPLET_MM = 3.0
FUELS = ["methanol", "heptane"]
TOP = 5
MIN_GAP = 0.25
HOLDOUT_O2 = 0.28


def frame(features: list[str], o2, mmhg, fuel: str) -> pd.DataFrame:
    o2 = np.asarray(o2, dtype=float)
    data = {
        "pressure_mmhg": np.asarray(mmhg, dtype=float),
        "oxygen_level": o2,
        "n2": 1 - o2,
        "co2": np.zeros_like(o2),
        "he": np.zeros_like(o2),
        "d_initial_mm": np.full_like(o2, DROPLET_MM),
        "fuel_heptane": np.full_like(o2, 1.0 if fuel == "heptane" else 0.0),
        "fuel_methanol": np.full_like(o2, 1.0 if fuel == "methanol" else 0.0),
    }
    return pd.DataFrame(data)[features]


def tree_spread(pipeline, x: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    forest = pipeline[-1]
    prepared = pipeline[:-1].transform(x)
    per_tree = np.stack([t.predict(prepared) for t in forest.estimators_])
    return per_tree.mean(axis=0), per_tree.std(axis=0)


def unit(a: np.ndarray) -> np.ndarray:
    span = a.max() - a.min()
    return (a - a.min()) / span if span else np.zeros_like(a)


def build_fuel(pipeline, features: list[str], flex: pd.DataFrame, fuel: str) -> dict:
    runs = flex[flex["fuel"] == fuel].reset_index(drop=True)
    oo, pp = np.meshgrid(OXY, PSI, indexing="ij")
    o2, psi = oo.ravel(), pp.ravel()

    value, spread = tree_spread(pipeline, frame(features, o2, psi * PSI_TO_MMHG, fuel))

    o_span, p_span = OXY[-1] - OXY[0], PSI[-1] - PSI[0]
    run_o = runs["oxygen_level"].to_numpy()
    run_p = runs["pressure_mmhg"].to_numpy() / PSI_TO_MMHG
    d = np.hypot((o2[:, None] - run_o[None, :]) / o_span, (psi[:, None] - run_p[None, :]) / p_span)
    nearest = d.argmin(axis=1)
    distance = d.min(axis=1)

    score = unit(spread) * unit(distance)

    picks: list[int] = []
    for i in np.argsort(-score):
        if all(np.hypot((o2[i] - o2[j]) / o_span, (psi[i] - psi[j]) / p_span) >= MIN_GAP for j in picks):
            picks.append(int(i))
        if len(picks) == TOP:
            break

    shape = (len(OXY), len(PSI))
    visible = runs[(run_p >= PSI[0] - 0.5) & (run_p <= PSI[-1] + 0.5)
                   & (run_o >= OXY[0] - 0.005) & (run_o <= OXY[-1] + 0.005)]
    points = (
        visible.assign(psi=(visible["pressure_mmhg"] / PSI_TO_MMHG).round(1))
        .groupby(["oxygen_level", "psi"]).size().reset_index(name="n")
    )

    return {
        "score": np.round(score.reshape(shape), 4).tolist(),
        "spread": np.round(spread.reshape(shape), 4).tolist(),
        "value": np.round(value.reshape(shape), 4).tolist(),
        "runs": [{"o2": float(r.oxygen_level), "psi": float(r.psi), "n": int(r.n)} for r in points.itertuples()],
        "runs_total": int(len(runs)),
        "suggestions": [{
            "o2": float(o2[i]),
            "psi": float(psi[i]),
            "value": round(float(value[i]), 3),
            "spread": round(float(spread[i]), 3),
            "score": round(float(score[i]), 3),
            "nearest": str(runs.loc[nearest[i], "test"]),
            "nearest_o2": float(run_o[nearest[i]]),
            "nearest_psi": round(float(run_p[nearest[i]]), 1),
        } for i in picks],
    }


def holdout(features: list[str], flex: pd.DataFrame) -> dict:
    rows = flex.dropna(subset=["burn_rate_mm2s"])
    low = rows[rows["oxygen_level"] <= HOLDOUT_O2]
    high = rows[rows["oxygen_level"] > HOLDOUT_O2]
    pipeline = make_pipeline(
        SimpleImputer(strategy="median"), StandardScaler(),
        RandomForestRegressor(n_estimators=300, min_samples_leaf=2, random_state=42, oob_score=True),
    )
    pipeline.fit(low[features], low["burn_rate_mm2s"])

    seen_error = float(np.abs(pipeline[-1].oob_prediction_ - low["burn_rate_mm2s"]).mean())
    _, seen_spread = tree_spread(pipeline, low[features])
    pred, hidden_spread = tree_spread(pipeline, high[features])
    hidden_error = float(np.abs(pred - high["burn_rate_mm2s"]).mean())
    return {
        "o2_above": HOLDOUT_O2,
        "hidden_rows": int(len(high)),
        "seen_rows": int(len(low)),
        "spread_seen": round(float(seen_spread.mean()), 4),
        "spread_hidden": round(float(hidden_spread.mean()), 4),
        "mae_seen": round(seen_error, 4),
        "mae_hidden": round(hidden_error, 4),
    }


def main() -> int:
    bundle = joblib.load(ROOT / "data/models/fiery.joblib")
    pipeline, features = bundle["model"], bundle["features"]
    flex = pd.read_csv(ROOT / "data/processed/flex.csv")
    flex = flex[flex["pressure_mmhg"] > 0].reset_index(drop=True)

    check = holdout(features, flex)
    gaps = {
        "oxygen_level": OXY,
        "pressure_psi": PSI,
        "droplet_mm": DROPLET_MM,
        "target": bundle["target"],
        "fuels": {fuel: build_fuel(pipeline, features, flex, fuel) for fuel in FUELS},
        "holdout": check,
    }
    OUT.write_text(json.dumps(gaps, separators=(",", ":")) + "\n", encoding="utf-8")

    for fuel in FUELS:
        for s in gaps["fuels"][fuel]["suggestions"]:
            print(f"{fuel:9s} O2 {s['o2']:.2f}  {s['psi']:4.1f} psi  score {s['score']:.2f}  "
                  f"nearest {s['nearest']} ({s['nearest_o2']:.2f}, {s['nearest_psi']} psi)  ±{s['spread']}")
    print(f"holdout: trained without O2 > {HOLDOUT_O2:.0%} ({check['hidden_rows']} runs hidden): "
          f"tree spread there {check['spread_hidden']} vs {check['spread_seen']} on seen data, "
          f"error {check['mae_hidden']} vs {check['mae_seen']} mm2/s")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
