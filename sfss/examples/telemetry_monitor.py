"""Сторонняя программа на SFSS: условный монитор атмосферы на станции.

Пример того, как подключить к SFSS своё ПО. Кроме httpx ему ничего не нужно, и
он не знает о сервисе ничего, кроме адреса: читает телеметрию, шлёт её пакетом в
/v1/predict/batch и при превышении порога спрашивает у отчётов NASA, что это значит.

Телеметрия вымышленная, порог условный. Модель считает скорость горения капли
топлива при такой атмосфере: это сравнение атмосфер, а не прогноз пожара на станции.

Запуск (нужен sfss start):
    python examples/telemetry_monitor.py
    python examples/telemetry_monitor.py --delay 0 --no-ask
"""

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
QUESTION = "Как повышение концентрации кислорода влияет на скорость горения?"


def read_telemetry(path: Path) -> list[dict]:
    with path.open(newline="") as file:
        return list(csv.DictReader(file))


def predict(client: httpx.Client, rows: list[dict]) -> list[dict]:
    response = client.post("/v1/predict/batch", json={"rows": rows})
    response.raise_for_status()
    return response.json()["rows"]


def ask_reports(client: httpx.Client, question: str) -> None:
    """Ответ приходит потоком, по строке JSON на событие."""
    print(f"\n  Спрашиваю отчёты NASA: {question}\n  ", end="", flush=True)
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
                print(f"\n  Модель недоступна: {event['detail']}")
                return
    print()
    for source in sources:
        print(f"  источник: {source['doc_id']}, стр. {source['page']}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="Монитор атмосферы на SFSS")
    parser.add_argument("--url", default=os.environ.get("SFSS_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--csv", type=Path, default=Path(__file__).with_name("station_telemetry.csv"))
    parser.add_argument("--delay", type=float, default=1.0, help="пауза между отсчётами, с")
    parser.add_argument("--threshold", type=float, default=1.15, help="тревога, во сколько раз быстрее воздуха")
    parser.add_argument("--no-ask", action="store_true", help="не спрашивать отчёты при тревоге")
    args = parser.parse_args()

    key = os.environ.get("SFSS_API_KEY")
    headers = {"X-API-Key": key} if key else {}
    alarmed: set[str] = set()

    try:
        with httpx.Client(base_url=args.url, headers=headers, timeout=10) as client:
            air = predict(client, [AIR])[0]["predicted_value"]
            print(f"SFSS {args.url}. Обычный воздух: {air:.3f} мм²/с, тревога от ×{args.threshold}\n")
            print(f"{'мин':>4}  {'модуль':<10} {'O₂, %':>6} {'мм рт. ст.':>11} {'мм²/с':>7} {'к воздуху':>10}")

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
                        print(f"\n  ТРЕВОГА: {module}, горит в {ratio:.2f} раза быстрее обычного воздуха")
                        if not args.no_ask:
                            ask_reports(client, QUESTION)
                time.sleep(args.delay)
    except httpx.ConnectError:
        print(f"SFSS не отвечает на {args.url}. Запустите: sfss start", file=sys.stderr)
        return 3
    except httpx.HTTPStatusError as exc:
        print(f"SFSS ответил {exc.response.status_code}: {exc.response.text}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
