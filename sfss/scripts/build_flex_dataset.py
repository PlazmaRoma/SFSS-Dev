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

ROW = re.compile(
    r"^FLEX[–—-](\d+)\s+(\S+)\s+(\d+/\d+/\d+)\s+(\d+:\d+:\d+)\s+(\w+)\s+"
    r"([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+"
    r"([\d.–—-]+)\s+([\d.–—-]+)\s+([\d.–—-]+)\s+"
    r"([\d.–—-]+)\s+(\w+)\s*$"
)

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
                "pressure_mmhg": _num(g[5]),
                "o2": _num(g[6]),
                "n2": _num(g[7]),
                "co2": _num(g[8]),
                "he": _num(g[9]),
                "d_initial_mm": _num(g[10]),
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
        raise FileNotFoundError(f"No report matching {PDF_GLOB} in {raw_dir}")

    df = parse_table(pdfs[0])
    logger.info("Rows parsed: %d", len(df))

    df = df.rename(columns={"o2": "oxygen_level"})

    dummies = pd.get_dummies(df["fuel"], prefix="fuel", dtype=float)
    df = pd.concat([df, dummies], axis=1)

    out_dir.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_dir / "flex.csv", index=False)
    return df


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Build the FLEX dataset")
    parser.add_argument("--raw-dir", type=Path, default=settings.raw_dir)
    parser.add_argument("--out-dir", type=Path, default=settings.processed_dir)
    args = parser.parse_args()

    df = build(args.raw_dir, args.out_dir)

    print(f"\nRows: {len(df)} | condition groups: {df.condition.nunique()}")
    print(f"Fuel: {df.fuel.value_counts().to_dict()}")
    print(f"Outcomes: {df.test_end.value_counts().to_dict()}\n")
    print("Coverage:")
    for col in ("pressure_mmhg", "oxygen_level", "n2", "co2", "he", "d_initial_mm",
                "d_extinction_mm", "burn_rate_mm2s", "burn_time_s"):
        series = df[col]
        print(f"  {col:18} {series.notna().sum():>4} / {len(df)}  unique: {series.nunique():>4}")
    print(f"\nSaved to {args.out_dir}/flex.csv")


if __name__ == "__main__":
    main()
