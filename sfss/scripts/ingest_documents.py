"""Офлайн-индексация PDF/CSV из data/raw в ChromaDB.

Запуск: python scripts/ingest_documents.py [--force]
"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.ingest_service import IngestService  # noqa: E402
from app.services.rag_service import RagService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


def main() -> None:
    parser = argparse.ArgumentParser(description="Индексация документов в ChromaDB")
    parser.add_argument(
        "--force", action="store_true", help="Переиндексировать уже загруженные файлы"
    )
    args = parser.parse_args()

    service = IngestService(rag=RagService())
    result = service.run(force=args.force)

    print(f"Проиндексировано файлов: {len(result.indexed_files)}")
    for name in result.indexed_files:
        print(f"  + {name}")
    if result.skipped_files:
        print(f"Пропущено: {', '.join(result.skipped_files)}")
    print(f"Добавлено чанков: {result.chunks_added}")
    print(f"Всего в коллекции: {service.rag.count()}")


if __name__ == "__main__":
    main()
