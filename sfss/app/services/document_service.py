"""Документы корпуса: список, загрузка PDF, отдача одной страницы."""

import hashlib
import io
import logging
import re
from pathlib import Path
from typing import BinaryIO

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError

from app.config import Settings, get_settings
from app.models.schemas import DocumentInfo
from app.services.ingest_service import IngestService
from app.services.rag_service import RagService

logger = logging.getLogger(__name__)

PDF_MAGIC = b"%PDF-"


class DocumentNotFoundError(LookupError):
    pass


class DocumentExistsError(RuntimeError):
    pass


class DocumentRejectedError(ValueError):
    """Файл не подходит: не PDF, слишком большой или без текста."""


class DocumentTooLargeError(DocumentRejectedError):
    pass


def safe_filename(name: str, content: bytes) -> str:
    """Имя файла из запроса → имя на диске, только ASCII и без каталогов.

    doc_id уходит в API и в ссылки ответа, а там действует правило «ASCII для
    машин». Имя целиком из кириллицы превратилось бы в пустое, поэтому у него
    вместо имени хеш содержимого.
    """
    base = Path(name.replace("\\", "/")).name
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(base).stem).strip("._-")
    if not stem:
        stem = "upload-" + hashlib.sha1(content).hexdigest()[:10]
    return f"{stem}.pdf"


class DocumentService:
    def __init__(
        self,
        rag: RagService,
        ingest: IngestService,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.rag = rag
        self.ingest = ingest

    def _files(self) -> list[Path]:
        return sorted(
            path
            for path in self.settings.raw_dir.glob("*.pdf")
            if path.is_file() and not path.name.startswith(".")
        )

    def list(self) -> list[DocumentInfo]:
        chunks: dict[str, int] = {}
        stored = self.rag.collection.get(include=["metadatas"])
        for meta in stored.get("metadatas") or []:
            if meta and meta.get("doc_id"):
                chunks[meta["doc_id"]] = chunks.get(meta["doc_id"], 0) + 1
        return [
            DocumentInfo(
                doc_id=path.stem,
                filename=path.name,
                chunks=chunks.get(path.stem, 0),
                size_bytes=path.stat().st_size,
            )
            for path in self._files()
        ]

    def find(self, doc_id: str) -> Path:
        """Файл документа по doc_id или короткому номеру из ссылки ответа.

        doc_id только сравнивается с именами из каталога и никогда не
        подставляется в путь, поэтому выйти за пределы data/raw им нельзя.
        В ответах модели ссылка короткая: [NTRS-20000030678, p. 97].
        """
        files = self._files()
        for path in files:
            if path.stem == doc_id:
                return path
        matches = [path for path in files if path.stem.startswith(f"{doc_id}-")]
        if len(matches) == 1:
            return matches[0]
        raise DocumentNotFoundError(doc_id)

    def page_pdf(self, doc_id: str, page: int) -> bytes:
        """Одна страница отдельным PDF, нумерация с единицы, как в sources."""
        reader = PdfReader(str(self.find(doc_id)))
        if not 1 <= page <= len(reader.pages):
            raise DocumentNotFoundError(f"{doc_id}, page {page}")
        writer = PdfWriter()
        writer.add_page(reader.pages[page - 1])
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()

    def add(self, filename: str, stream: BinaryIO) -> DocumentInfo:
        limit = self.settings.max_upload_mb * 1024 * 1024
        content = stream.read(limit + 1)
        if len(content) > limit:
            raise DocumentTooLargeError(f"File is larger than {self.settings.max_upload_mb} MB")
        if not content.startswith(PDF_MAGIC):
            raise DocumentRejectedError("Not a PDF file")

        name = safe_filename(filename, content)
        path = self.settings.raw_dir / name
        try:
            # Режим x: два одновременных запроса не перезапишут файл друг друга
            with path.open("xb") as file:
                file.write(content)
        except FileExistsError:
            raise DocumentExistsError(name) from None

        try:
            chunks = self.ingest.ingest_pdf(path)
        except PdfReadError as exc:
            path.unlink(missing_ok=True)
            raise DocumentRejectedError(f"Cannot read PDF: {exc}") from exc
        except Exception:
            path.unlink(missing_ok=True)
            raise
        if not chunks:
            path.unlink(missing_ok=True)
            raise DocumentRejectedError("No text layer in the PDF: scans are not supported")

        logger.info("Добавлен документ %s: %d фрагментов", name, chunks)
        return DocumentInfo(
            doc_id=path.stem, filename=name, chunks=chunks, size_bytes=len(content)
        )
