"""Сборка датасета FLEX для регрессии скорости горения.

Источник — таблица тестов из отчёта `NTRS-20150023456.pdf` (Detailed Results
from the Flame Extinguishment Experiment, стр. 26-34). Один ряд = один опыт
по сжиганию капли топлива на МКС.

Почему FLEX, а не BASS-II
-------------------------
В BASS-II единственная непрерывная величина, до которой удалось дотянуться, —
последняя уставка потока, а не измеренная скорость гашения: 32 % значений
это ровно 5.0 см/с, четыре значения покрывают 65 % выборки, и корреляция с
кислородом имеет физически неверный знак. Регрессия по такой цели выучила бы
протокол опыта.

У FLEX величины измерены прибором: скорость горения имеет 60 уникальных
значений на 259 строк (самое частое — 6 %), а её корреляция с концентрацией
кислорода равна +0.55, что физически верно: больше кислорода — быстрее горит.

Целевые переменные
------------------
* `burn_rate_mm2s` — скорость горения, мм²/с. Основная цель регрессии:
  насколько быстро расходуется топливо, то есть интенсивность горения.
* `d_extinction_mm` — диаметр капли в момент погасания. Чем он больше, тем
  раньше гаснет пламя.
* `test_end` — исход (Extinction / Disruption / Completion), для классификации.

Запуск: python scripts/build_flex_dataset.py
Результат: data/processed/flex.parquet (+ .csv)
"""

import argparse
import logging
import re
import sys
from pathlib import Path

import pandas as pd
from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

PDF_GLOB = "NTRS-20150023456*.pdf"
TABLE_PAGES = range(26, 35)

# FLEX-140 C14M101 11/4/10 16:52:39 Methanol 533.5 .15 .35 .5 0 3.98 3.95 .2 1.3 Extinction
ROW = re.compile(
    r"^FLEX[–—-](\d+)\s+(\S+)\s+(\d+/\d+/\d+)\s+(\d+:\d+:\d+)\s+(\w+)\s+"
    r"([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+"
    r"([\d.–—-]+)\s+([\d.–—-]+)\s+([\d.–—-]+)\s+"
    r"([\d.–—-]+)\s+(\w+)\s*$"
)

# Идентификатор опыта вида C14M101: C14 — код условий среды, M/H — топливо.
# Тесты с одним кодом условий проводились подряд при одной атмосфере, поэтому
# независимыми строками не являются и должны попадать в один фолд.
CONDITION = re.compile(r"^(C\d+)")


def _num(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def parse_table(pdf_path: Path) -> pd.DataFrame:
    reader = PdfReader(str(pdf_path))
    text = "\n".join((reader.pages[p - 1].extract_text() or "") for p in TABLE_PAGES)

    rows = []
    for line in text.splitlines():
        m = ROW.match(line.strip())
        if not m:
            continue
        g = m.groups()
        identifier = g[1]
        condition = CONDITION.match(identifier)
        rows.append(
            {
                "test": f"FLEX-{g[0]}",
                "identifier": identifier,
                "condition": condition.group(1) if condition else identifier,
                "fuel": g[4].lower(),
                # --- условия опыта (признаки) ---
                "pressure_mmhg": _num(g[5]),
                "o2": _num(g[6]),
                "n2": _num(g[7]),
                "co2": _num(g[8]),
                "he": _num(g[9]),
                "d_initial_mm": _num(g[10]),
                # --- измеренные результаты (цели, в признаки не идут) ---
                "d_extinction_mm": _num(g[11]),
                "burn_rate_mm2s": _num(g[12]),
                "burn_time_s": _num(g[13]),
                "test_end": g[14].lower(),
            }
        )
    return pd.DataFrame(rows)


def build(raw_dir: Path, out_dir: Path) -> pd.DataFrame:
    pdfs = sorted(raw_dir.glob(PDF_GLOB))
    if not pdfs:
        raise FileNotFoundError(f"Не найден отчёт по маске {PDF_GLOB} в {raw_dir}")

    df = parse_table(pdfs[0])
    logger.info("Строк разобрано: %d", len(df))

    # `oxygen_level` — имя из ТЗ; дубля `o2` не держим, иначе важность признака
    # дробится между двумя одинаковыми колонками
    df = df.rename(columns={"o2": "oxygen_level"})

    dummies = pd.get_dummies(df["fuel"], prefix="fuel", dtype=float)
    df = pd.concat([df, dummies], axis=1)

    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_dir / "flex.parquet", index=False)
    df.to_csv(out_dir / "flex.csv", index=False)
    return df


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Сборка датасета FLEX")
    parser.add_argument("--raw-dir", type=Path, default=settings.raw_dir)
    parser.add_argument("--out-dir", type=Path, default=settings.processed_dir)
    args = parser.parse_args()

    df = build(args.raw_dir, args.out_dir)

    print(f"\nСтрок: {len(df)} | групп условий: {df.condition.nunique()}")
    print(f"Топливо: {df.fuel.value_counts().to_dict()}")
    print(f"Исходы:  {df.test_end.value_counts().to_dict()}\n")
    print("Заполненность:")
    for col in ("pressure_mmhg", "oxygen_level", "n2", "co2", "he", "d_initial_mm",
                "d_extinction_mm", "burn_rate_mm2s", "burn_time_s"):
        series = df[col]
        print(f"  {col:18} {series.notna().sum():>4} / {len(df)}  уникальных: {series.nunique():>4}")
    print(f"\nСохранено в {args.out_dir}/flex.parquet")


if __name__ == "__main__":
    main()
