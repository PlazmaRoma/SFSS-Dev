#!/usr/bin/env python3
"""Снимок модели по трём осям: кислород, давление, размер капли.

Зачем: программа скачивается и запускается без бэкенда. Раньше оффлайн
подбиралась ближайшая точка только по кислороду, и два ползунка из трёх
не двигали цифру. По живой модели размер капли меняет скорость горения
в 1.43 раза, так что молчать об этом нельзя.

Куб маленький: 25 x 14 x 17 = 5950 чисел. Между узлами интерполируем
линейно уже в браузере.
"""
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "src/shared/fixtures"
PSI_TO_MMHG = 51.715

OXY = [round(0.16 + i * 0.01, 3) for i in range(25)]        # 16…40 %
# Два давления обязаны быть узлами: 14.7 psi — земная норма, от неё
# считается отношение, и 8.2 psi — разведочная атмосфера NASA. Иначе
# заголовочные 1.40x оффлайн превращаются в 1.38x.
PSI = sorted([5 + i for i in range(12)] + [8.2, 14.7])      # 5…16 psi
DROP = [round(1 + i * 0.25, 2) for i in range(17)]          # 1…5 мм


def predict(o: float, psi: float, d: float) -> dict:
    body = {"parameters": {
        "oxygen_level": o,
        "n2": round(1 - o, 3),
        "pressure_mmhg": round(psi * PSI_TO_MMHG, 1),
        "d_initial_mm": d,
    }}
    req = urllib.request.Request(
        BASE + "/predict", data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main() -> int:
    jobs = [(io, ip, id_) for io in range(len(OXY))
            for ip in range(len(PSI)) for id_ in range(len(DROP))]

    values = [[[0.0] * len(DROP) for _ in PSI] for _ in OXY]
    heur = [[[0] * len(DROP) for _ in PSI] for _ in OXY]
    defaults: set[str] = set()
    target = ""

    def run(job):
        io, ip, id_ = job
        return job, predict(OXY[io], PSI[ip], DROP[id_])

    done = 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        for (io, ip, id_), r in pool.map(run, jobs):
            values[io][ip][id_] = round(r["predicted_value"], 5)
            heur[io][ip][id_] = 1 if r.get("is_heuristic") else 0
            defaults.update(r.get("defaults_applied") or [])
            target = r.get("target") or target
            done += 1
            if done % 300 == 0:
                print(f"  {done}/{len(jobs)}", file=sys.stderr)

    flat_heur = [h for plane in heur for row in plane for h in row]
    cube = {
        "oxygen_level": OXY,
        "pressure_psi": PSI,
        "droplet_mm": DROP,
        "values": values,
        "target": target,
        "defaults_applied": sorted(defaults),
        # Эвристику модель включает у края обучающего диапазона. Если её нет
        # нигде, флаг не храним и в браузере считаем его выключенным.
        "heuristic": flat_heur if any(flat_heur) else None,
    }

    out = OUT / "predict_cube.json"
    out.write_text(json.dumps(cube, separators=(",", ":")))

    lo = min(v for p in values for row in p for v in row)
    hi = max(v for p in values for row in p for v in row)
    print(f"→ {out}  ({out.stat().st_size // 1024} КБ), {len(jobs)} точек, "
          f"значения {lo:.3f}…{hi:.3f}, эвристика: "
          f"{sum(flat_heur)} точек")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
