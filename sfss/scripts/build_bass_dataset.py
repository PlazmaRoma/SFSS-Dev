"""Сборка обучающего датасета BASS-II для модели fiery.

Два источника, оба уже лежат в data/raw:

* `PSI-25_BASS-II_test_matrix.csv` — таблица экспериментов с сайта NASA PSI.
  Даёт машиночитаемые числа: концентрации O2/CO2/CO, ограничитель потока.
  Колонки исхода в ней нет — сайт отдаёт таблицу усечённой.
* `NTRS-20210011385-...pdf` — Summary Report BASS-II. В Приложении A
  (стр. 111-122, таблицы A.1-A.6 по одной на каждого PI) лежит та же самая
  матрица, но целиком — вместе с колонкой «Test observations and anomalies»
  и конфигурацией потока Opposed/Concurrent.

Соединение по паре (номер теста, номер образца) — она уникальна и устойчива,
в отличие от одного номера теста: идентификатор `O2` совпал бы с формулой
кислорода в тексте.

Запуск: python scripts/build_bass_dataset.py
Результат: data/processed/bass_ii.parquet (+ .csv для глазами посмотреть)
"""

import argparse
import logging
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from pypdf import PdfReader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

CSV_NAME = "PSI-25_BASS-II_test_matrix.csv"
PDF_GLOB = "NTRS-20210011385-*.pdf"
APPENDIX_A_PAGES = range(111, 123)

# --- классификация исхода ------------------------------------------------
# Порядок важен: тест мог поджечься и затем погаснуть — это «extinction»,
# а не «sustained_burn». Отсутствие поджига проверяется первым.
OUTCOME_RULES = [
    (
        "no_ignition",
        r"no ignition|did not ignite|would not ignite|never ignited|failed to ignite"
        r"|no sustained flame|would not stay lit|would not sustain|brief ignition flash",
    ),
    ("blowoff", r"blow ?off|blew off|blow-off"),
    ("extinction", r"extinguish|extinction|quench|went out|flame ?out"),
    ("sustained_burn", r"steady|spread|sustained|\bburn\w*\b|flame|sooty"),
]


def classify_outcome(segment: str) -> str:
    low = segment.lower()
    for label, pattern in OUTCOME_RULES:
        if re.search(pattern, low):
            return label
    return "unknown"


# --- разбор описания образца --------------------------------------------

MATERIALS = [
    # «clear rod» и «black rod» в BASS-II — это стержни PMMA: в отчёте они
    # встречаются и в полной форме («12.7-mm clear pmma rod»), но в таблице
    # слово PMMA у большинства строк опущено.
    ("pmma", r"pmma|acrylic|clear rod|black rod"),
    ("sibal", r"sibal"),
    ("nomex", r"nomex"),
    ("wax", r"wax|candle|paraffin"),
    ("ultem", r"ultem"),
]
SHAPES = [
    ("film", r"film"),
    ("rod", r"rod"),
    ("slab", r"slab"),
    ("sphere", r"spher"),
    ("fabric", r"sibal|nomex|fabric"),
    ("candle", r"candle"),
]


def _first_match(text: str, table: list[tuple[str, str]]) -> str:
    low = text.lower()
    for name, pattern in table:
        if re.search(pattern, low):
            return name
    return "other"


def parse_thickness_mm(text: str) -> float | None:
    """Толщина образца в мм из описаний вида '100-µm', '0.2 mm', '3 mm thick'."""
    m = re.search(r"([\d.]+)\s*[-\s]?(?:µm|micron|um)\b", text, re.I)
    if m:
        return float(m.group(1)) / 1000.0
    m = re.search(r"([\d.]+)\s*[-\s]?mm[-\s]?thick", text, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"([\d.]+)\s*mm\s+(?:thick|pmma|film)", text, re.I)
    if m:
        return float(m.group(1))
    return None


def parse_diameter_mm(text: str) -> float | None:
    """Диаметр стержня. В отчёте метрический (6.35-mm), в CSV дюймовый."""
    m = re.search(r"([\d.]+)\s*[-\s]?mm\s+(?:clear|black)?\s*(?:pmma\s*)?rod", text, re.I)
    if m:
        return float(m.group(1))
    inches = {"1/4": 6.35, "3/8": 9.525, "1/2": 12.7, "0.5": 12.7}
    for frac, mm in inches.items():
        if re.search(rf"{re.escape(frac)}\s*(?:in\b|\"|inch)", text, re.I):
            return mm
    return None


def parse_width_cm(text: str) -> float | None:
    m = re.search(r"([\d.]+)\s*cm\s*(?:wide|width)", text, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"([\d.]+)[-\s]?cm[-\s]?wide", text, re.I)
    if m:
        return float(m.group(1))
    m = re.search(r"\b([\d.]+)\s*cm\b", text, re.I)
    return float(m.group(1)) if m else None


def parse_flow_config(segment: str) -> str:
    low = segment.lower()
    for name in ("opposed", "concurrent", "stagnation"):
        if name in low:
            return name
    return "unknown"


# --- скорость потока из калибровочной таблицы ----------------------------
#
# `Fan calibration data.xlsx` из Raw Data PSI-25. Устройство: по горизонтали
# блоки по 4 колонки на каждый день опытов (Pot | Fan Display | Air Display),
# по вертикали три секции — 0, 1 и 2 ограничителя потока.
#
# Пересчёт зафиксирован в самой таблице: U = 1.0066 x (Air Display), см/с.
# Источник калибровки указан там же: SPICE, 56 мм ниже по потоку, 36 мм от дна.
# Коэффициент проверен на всех 15 контрольных парах — расхождение нулевое.
#
# Калибровку переснимали почти каждый день, поэтому кривая Fan Display -> U
# привязывается к GMT опыта; если для этого дня калибровки нет, берётся
# усреднённая по всем дням кривая для того же числа ограничителей.

CALIBRATION_NAME = "PSI-25/Fan_calibration_data.xlsx"
AIR_TO_CMS = 1.0066
CAL_SECTIONS = {0: (6, 13), 1: (15, 21), 2: (24, 31)}  # строки секций по ограничителям

# Ниже 38 единиц Fan Display вентилятор не крутится. Отсюда правило различения
# колонок: если в последовательности есть значение < 38, это скорости в см/с
# (единицы Fan Display такими не бывают); если все значения >= 38 — это единицы
# Fan Display, попавшие в колонку Air display, и их надо пересчитать.
FAN_OFF = 38.0
MAX_PLAUSIBLE_CMS = 60.0  # потолок калибровки — 59.4 см/с без ограничителей


def load_fan_calibration(path: Path) -> pd.DataFrame:
    """Точки калибровки: (GMT дня, число ограничителей, Fan Display, см/с)."""
    raw = pd.read_excel(path, header=None)
    blocks = [j for j in range(raw.shape[1]) if str(raw.iat[5, j]).strip().lower() == "pot"]

    points = []
    for j in blocks:
        gmt_cell = raw.iat[3, j + 1] if j + 1 < raw.shape[1] else None
        m = re.search(r"20\d\d\s*[-\u2013]\s*0*(\d{1,3})", str(gmt_cell))
        gmt = int(m.group(1)) if m else None
        for restrictor, (top, bottom) in CAL_SECTIONS.items():
            for i in range(top, min(bottom, len(raw))):
                fan, air = raw.iat[i, j + 1], raw.iat[i, j + 2]
                try:
                    fan, air = float(fan), float(air)
                except (TypeError, ValueError):
                    continue
                if pd.isna(fan) or pd.isna(air):
                    continue
                points.append(
                    {"gmt": gmt, "restrictor": restrictor,
                     "fan_display": fan, "velocity_cms": air * AIR_TO_CMS}
                )
    return pd.DataFrame(points).drop_duplicates()


def build_velocity_curves(cal: pd.DataFrame) -> dict:
    """{(gmt, restrictor): (fan[], cms[])}, плюс (None, restrictor) — среднее по дням."""
    curves: dict = {}
    for key, group in cal.groupby(["gmt", "restrictor"], dropna=False):
        agg = group.groupby("fan_display").velocity_cms.mean().sort_index()
        curves[(key[0], key[1])] = (agg.index.to_numpy(), agg.to_numpy())
    for restrictor, group in cal.groupby("restrictor"):
        agg = group.groupby("fan_display").velocity_cms.mean().sort_index()
        curves[(None, restrictor)] = (agg.index.to_numpy(), agg.to_numpy())
    return curves


def fan_to_cms(fan_value: float, gmt, restrictor, curves: dict) -> float | None:
    """Линейная интерполяция Fan Display -> см/с по кривой нужного дня."""
    for key in ((gmt, restrictor), (None, restrictor)):
        curve = curves.get(key)
        if curve is not None and len(curve[0]) >= 2:
            return float(np.interp(fan_value, curve[0], curve[1]))
    return None


_NUMBERS = re.compile(r"\d+(?:\.\d+)?")


def _numbers(cell) -> list[float]:
    return [float(x) for x in _NUMBERS.findall(str(cell))] if pd.notna(cell) else []


def extract_flow(row, curves: dict) -> dict:
    """Последовательность скоростей опыта в см/с.

    В большинстве строк колонка `Air display` уже содержит скорость. Но у части
    PI колонки сдвинуты: в `Fan display` лежат значения потенциометра, а в
    `Air display` — единицы Fan Display. Такие строки распознаются по величине
    (>= 38) и пересчитываются по калибровке.
    """
    air = _numbers(row["Air display"])
    fan = _numbers(row["Fan display"])
    gmt = pd.to_numeric(row["GMT"], errors="coerce")
    gmt = int(gmt) if pd.notna(gmt) else None
    restrictor = pd.to_numeric(row["Flow restrictor"], errors="coerce")
    restrictor = int(restrictor) if pd.notna(restrictor) else 2

    speeds: list[float] = []
    if air and min(air) < FAN_OFF:
        speeds = [a for a in air if a <= MAX_PLAUSIBLE_CMS]   # уже см/с
    elif air:                                                 # все >= 38 -> Fan Display
        speeds = [v for v in (fan_to_cms(a, gmt, restrictor, curves) for a in air) if v is not None]
    elif fan and min(fan) >= FAN_OFF:
        speeds = [v for v in (fan_to_cms(f, gmt, restrictor, curves) for f in fan) if v is not None]
    # строки, где есть только значения потенциометра (шкала 0.2-10), остаются
    # без скорости: у Olson и Fernandez-Pello потенциометр мелкий и в
    # калибровочную шкалу Pot (0-10) не отображается

    if not speeds:
        return {"flow_initial_cms": None, "flow_final_cms": None,
                "flow_min_cms": None, "flow_max_cms": None, "flow_decreasing": None}
    return {
        "flow_initial_cms": speeds[0],
        "flow_final_cms": speeds[-1],
        "flow_min_cms": min(speeds),
        "flow_max_cms": max(speeds),
        "flow_decreasing": float(speeds[-1] < speeds[0]),
    }


# --- извлечение Приложения A --------------------------------------------


def load_appendix_a(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    pages = [reader.pages[p - 1].extract_text() or "" for p in APPENDIX_A_PAGES]
    return re.sub(r"\s+", " ", "\n".join(pages))


def locate_records(appendix: str, df: pd.DataFrame) -> dict[str, tuple[int, int]]:
    """Границы записи каждого теста в сплошном тексте приложения.

    Якорь — пара «номер теста + номер образца»: одного номера теста мало,
    идентификатор O2 неотличим от формулы кислорода.
    """
    found: list[tuple[int, str]] = []
    for _, row in df.iterrows():
        test, sample = str(row["Test #"]), str(row["Sample #"])
        anchor = rf"(?<![A-Za-z0-9]){re.escape(test)}\s+{re.escape(sample)}\b"
        m = re.search(anchor, appendix, re.I)
        if m:
            found.append((m.start(), test))

    found.sort()
    spans: dict[str, tuple[int, int]] = {}
    for i, (start, test) in enumerate(found):
        end = found[i + 1][0] if i + 1 < len(found) else min(start + 700, len(appendix))
        spans[test] = (start, end)
    return spans


# --- сборка --------------------------------------------------------------


def build(raw_dir: Path, out_dir: Path) -> pd.DataFrame:
    csv_path = raw_dir / CSV_NAME
    pdfs = sorted(raw_dir.glob(PDF_GLOB))
    if not csv_path.exists():
        raise FileNotFoundError(f"Не найден {csv_path}")
    if not pdfs:
        raise FileNotFoundError(f"Не найден отчёт по маске {PDF_GLOB} в {raw_dir}")

    df = pd.read_csv(csv_path)
    appendix = load_appendix_a(pdfs[0])

    cal_path = raw_dir / CALIBRATION_NAME
    if cal_path.exists():
        curves = build_velocity_curves(load_fan_calibration(cal_path))
        logger.info("Калибровочных кривых загружено: %d", len(curves))
    else:
        curves = {}
        logger.warning("Нет %s — скорость потока извлечена не будет", cal_path)
    spans = locate_records(appendix, df)
    logger.info("Записей найдено в Приложении A: %d из %d", len(spans), len(df))

    rows = []
    for _, row in df.iterrows():
        test = str(row["Test #"])
        span = spans.get(test)
        segment = appendix[span[0] : span[1]] if span else ""
        # описание образца берём из отчёта (метрическое), CSV — как запасной
        material_text = f"{segment} {row['Fuel Sample Material']}"

        o2 = pd.to_numeric(row["Calibrated initial O2 % by vol"], errors="coerce")
        rows.append(
            {
                "test": test,
                "pi": row["PI"],
                "sample": row["Sample #"],
                # --- признаки: только условия ДО опыта ---
                "oxygen_level": o2 / 100.0 if pd.notna(o2) else None,
                "co2_initial": pd.to_numeric(row["Initial CO2 % by vol"], errors="coerce"),
                "co_initial": pd.to_numeric(row["Initial CO (ppm)"], errors="coerce"),
                "flow_restrictor": pd.to_numeric(row["Flow restrictor"], errors="coerce"),
                **extract_flow(row, curves),
                "thickness_mm": parse_thickness_mm(material_text),
                "diameter_mm": parse_diameter_mm(material_text),
                "width_cm": parse_width_cm(material_text),
                "material": _first_match(material_text, MATERIALS),
                "shape": _first_match(material_text, SHAPES),
                "flow_config": parse_flow_config(segment),
                # --- целевая переменная ---
                "outcome": classify_outcome(segment) if segment else "unknown",
                # --- для прослеживаемости, в обучение не идёт ---
                "in_report": bool(span),
            }
        )

    out = pd.DataFrame(rows)

    # категориальные -> числовые, иначе train_model.py их молча отбросит
    for col in ("material", "shape", "flow_config"):
        dummies = pd.get_dummies(out[col], prefix=col, dtype=float)
        out = pd.concat([out, dummies], axis=1)

    out_dir.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_dir / "bass_ii.parquet", index=False)
    out.to_csv(out_dir / "bass_ii.csv", index=False)
    return out


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Сборка датасета BASS-II")
    parser.add_argument("--raw-dir", type=Path, default=settings.raw_dir)
    parser.add_argument("--out-dir", type=Path, default=settings.processed_dir)
    args = parser.parse_args()

    df = build(args.raw_dir, args.out_dir)

    labelled = df[df.outcome != "unknown"]
    print(f"\nСтрок всего: {len(df)} | найдено в отчёте: {int(df.in_report.sum())}")
    print(f"Размечено исходом: {len(labelled)}\n")
    print("Распределение исходов:")
    print(df.outcome.value_counts().to_string())
    print("\nЗаполненность признаков:")
    for col in ("oxygen_level", "co2_initial", "co_initial", "flow_restrictor",
                "flow_initial_cms", "flow_final_cms", "flow_min_cms", "flow_decreasing",
                "thickness_mm", "diameter_mm", "width_cm"):
        print(f"  {col:18} {df[col].notna().sum():>4} / {len(df)}")
    print(f"\nСохранено в {args.out_dir}/bass_ii.parquet")


if __name__ == "__main__":
    main()
