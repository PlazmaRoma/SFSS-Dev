"""BASS-II -> fixtures/bass_experiments.json для фронтенда.

Это НЕ предсказание модели, а факты из опытов NASA BASS-II.
Формулировать в UI надо как «в опыте №X при таком кислороде произошло Y».
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
df = pd.read_csv(ROOT.parent / "data/processed/bass_ii.csv")

RU_MATERIAL = {
    "pmma": "Оргстекло (PMMA)",
    "sibal": "Ткань SIBAL",
    "nomex": "Номекс",
    "wax": "Воск",
    "other": "Другое",
}
RU_SHAPE = {
    "rod": "стержень", "fabric": "ткань", "film": "плёнка",
    "slab": "пластина", "sphere": "шар", "candle": "свеча", "other": "другое",
}
RU_OUTCOME = {
    "extinction": "погасло",
    "sustained_burn": "устойчиво горело",
    "blowoff": "сорвало потоком",
    "no_ignition": "не зажглось",
    "unknown": "не установлено",
}
RU_FLOW = {
    "concurrent": "поток по направлению пламени",
    "opposed": "поток навстречу пламени",
    "stagnation": "застойная зона",
    "unknown": "не указано",
}

def num(v):
    return None if pd.isna(v) else round(float(v), 4)

records = []
for _, r in df.iterrows():
    records.append({
        "test": str(r["test"]),
        "sample": str(r["sample"]),
        "pi": str(r["pi"]),
        "material": r["material"],
        "material_ru": RU_MATERIAL.get(r["material"], r["material"]),
        "shape": r["shape"],
        "shape_ru": RU_SHAPE.get(r["shape"], r["shape"]),
        # доля (0.21) — в таком виде её ждёт /predict; процент — для показа человеку
        "oxygen_level": num(r["oxygen_level"]),
        "oxygen_pct": None if pd.isna(r["oxygen_level"]) else round(float(r["oxygen_level"]) * 100, 2),
        # co2_initial в паркете уже в процентах (0-1.85), в отличие от oxygen_level
        "co2_pct": num(r["co2_initial"]),
        "flow_config": r["flow_config"],
        "flow_config_ru": RU_FLOW.get(r["flow_config"], r["flow_config"]),
        "flow_initial_cms": num(r["flow_initial_cms"]),
        "flow_final_cms": num(r["flow_final_cms"]),
        "thickness_mm": num(r["thickness_mm"]),
        "diameter_mm": num(r["diameter_mm"]),
        "width_cm": num(r["width_cm"]),
        "outcome": r["outcome"],
        "outcome_ru": RU_OUTCOME.get(r["outcome"], r["outcome"]),
        "in_report": bool(r["in_report"]),
    })

labeled = [x for x in records if x["outcome"] != "unknown"]
by_material = {}
for x in labeled:
    m = by_material.setdefault(x["material"], {
        "material_ru": x["material_ru"], "tests": 0,
        "oxygen_min": None, "oxygen_max": None, "outcomes": {},
    })
    m["tests"] += 1
    m["outcomes"][x["outcome"]] = m["outcomes"].get(x["outcome"], 0) + 1
    o = x["oxygen_pct"]
    if o is not None:
        m["oxygen_min"] = o if m["oxygen_min"] is None else min(m["oxygen_min"], o)
        m["oxygen_max"] = o if m["oxygen_max"] is None else max(m["oxygen_max"], o)

payload = {
    "_source": "NASA BASS-II (Burning and Suppression of Solids II), эксперимент на МКС",
    "_report": "NTRS-20210011385 — BASS-II Summary Report, Приложение A (стр. 111-122)",
    "_data": "NASA PSI, исследование PSI-25",
    "_warning": (
        "Исход опыта наполовину отражает ПРОЦЕДУРУ теста: экипаж штатно снижал поток "
        "воздуха до срыва пламени, поэтому 'погасло' — самый частый исход. "
        "Это НЕ оценка пожаробезопасности материала. В интерфейсе подавать как "
        "факт конкретного опыта, а не как вывод о материале."
    ),
    "total": len(records),
    "labeled": len(labeled),
    "by_material": by_material,
    "experiments": records,
}

out = ROOT / "src/shared/fixtures/bass_experiments.json"
out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"→ {out}  ({out.stat().st_size // 1024} КБ, {len(records)} опытов)")
for k, v in sorted(by_material.items(), key=lambda kv: -kv[1]["tests"]):
    print(f"   {v['material_ru']:<22} {v['tests']:>3} оп.  O2 {v['oxygen_min']}-{v['oxygen_max']}%  {v['outcomes']}")
