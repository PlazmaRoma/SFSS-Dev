import argparse
import csv
import json
import os
import sys
import time
from itertools import groupby
from pathlib import Path

import httpx

AIR = {"oxygen_level": 0.21, "n2": 0.79, "pressure_mmhg": 760.0}
QUESTION = "How does a higher oxygen concentration affect the burning rate?"


def read_telemetry(path: Path) -> list[dict]:
    with path.open(newline="") as file:
        return list(csv.DictReader(file))


def predict(client: httpx.Client, rows: list[dict]) -> list[dict]:
    response = client.post("/v1/predict/batch", json={"rows": rows})
    response.raise_for_status()
    return response.json()["rows"]


def ask_reports(client: httpx.Client, question: str) -> None:
    print(f"\n  Asking the NASA reports: {question}\n  ", end="", flush=True)
    payload = {"question": question, "language": "ru"}
    sources = []
    with client.stream("POST", "/v1/query/stream", json=payload, timeout=180) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            event = json.loads(line)
            if event["type"] == "sources":
                sources = event["sources"]
            elif event["type"] == "delta":
                print(event["text"], end="", flush=True)
            elif event["type"] == "error":
                print(f"\n  Model unavailable: {event['detail']}")
                return
    print()
    for source in sources:
        print(f"  source: {source['doc_id']}, p. {source['page']}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Station atmosphere monitor built on SFSS")
    parser.add_argument("--url", default=os.environ.get("SFSS_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--csv", type=Path, default=Path(__file__).with_name("station_telemetry.csv"))
    parser.add_argument("--delay", type=float, default=1.0, help="pause between readings, s")
    parser.add_argument("--threshold", type=float, default=1.15, help="alarm when burning this many times faster than air")
    parser.add_argument("--no-ask", action="store_true", help="do not ask the reports on alarm")
    args = parser.parse_args()

    key = os.environ.get("SFSS_API_KEY")
    headers = {"X-API-Key": key} if key else {}
    alarmed: set[str] = set()

    try:
        with httpx.Client(base_url=args.url, headers=headers, timeout=10) as client:
            air = predict(client, [AIR])[0]["predicted_value"]
            print(f"SFSS {args.url}. Normal air: {air:.3f} mm²/s, alarm from ×{args.threshold}\n")
            print(f"{'min':>4}  {'module':<10} {'O₂, %':>6} {'mmHg':>11} {'mm²/s':>7} {'vs air':>10}")

            telemetry = read_telemetry(args.csv)
            for minute, group in groupby(telemetry, key=lambda row: row["minute"]):
                records = list(group)
                rows = [
                    {name: float(record[name]) for name in ("oxygen_level", "n2", "pressure_mmhg")}
                    for record in records
                ]
                for record, result in zip(records, predict(client, rows)):
                    module = record["module"]
                    value = result["predicted_value"]
                    ratio = value / air
                    print(
                        f"{minute:>4}  {module:<10} {float(record['oxygen_level']) * 100:>6.1f} "
                        f"{float(record['pressure_mmhg']):>11.0f} {value:>7.3f} {ratio:>9.2f}×"
                    )
                    if ratio >= args.threshold and module not in alarmed:
                        alarmed.add(module)
                        print(f"\n  ALARM: {module} burns {ratio:.2f} times faster than normal air")
                        if not args.no_ask:
                            ask_reports(client, QUESTION)
                time.sleep(args.delay)
    except httpx.ConnectError:
        print(f"SFSS is not answering at {args.url}. Start it: sfss start", file=sys.stderr)
        return 3
    except httpx.HTTPStatusError as exc:
        print(f"SFSS answered {exc.response.status_code}: {exc.response.text}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
