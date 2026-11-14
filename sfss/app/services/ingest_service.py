import hashlib
import logging
import re
from pathlib import Path

import pandas as pd
from pypdf import PdfReader

from app.config import Settings, get_settings
from app.models.schemas import IngestResponse
from app.services.rag_service import RagService

logger = logging.getLogger(__name__)


_STOPWORDS = frozenset(
    "the of and to in is for that with on as by are was be this from at or an "
    "it which were have has not can".split()
)
_WORD_RE = re.compile(r"[A-Za-z]+")
_LAYOUT_CHARS = frozenset(" \n")
_DETECT_SAMPLE_CHARS = 20_000
_DETECT_MIN_WORDS = 200
_GARBLED_MAX_SHARE = 0.05
_DECODED_MIN_SHARE = 0.15
_DECODED_MAX_UNMAPPED = 0.05


def _stopword_share(text: str) -> tuple[float, int]:
    words = _WORD_RE.findall(text)
    if not words:
        return 0.0, 0
    return sum(w.lower() in _STOPWORDS for w in words) / len(words), len(words)


def _unmapped_share(text: str, shift: int) -> float:
    glyphs = [ch for ch in text if ch not in _LAYOUT_CHARS]
    if not glyphs:
        return 1.0
    return sum(not 0x20 <= ord(ch) + shift <= 0x7E for ch in glyphs) / len(glyphs)


def shift_text(text: str, shift: int) -> str:
    out = []
    for ch in text:
        if ch in _LAYOUT_CHARS:
            out.append(ch)
            continue
        code = ord(ch) + shift
        out.append(chr(code) if 0x20 <= code <= 0x7E else " ")
    return "".join(out)


def detect_shift(text: str) -> int | None:
    sample = text[:_DETECT_SAMPLE_CHARS]
    share, _ = _stopword_share(sample)
    if share >= _GARBLED_MAX_SHARE:
        return None

    best_shift, best_share = None, 0.0
    for shift in range(-64, 65):
        if shift == 0 or _unmapped_share(sample, shift) > _DECODED_MAX_UNMAPPED:
            continue
        share, words = _stopword_share(shift_text(sample, shift))
        if words >= _DETECT_MIN_WORDS and share > best_share:
            best_shift, best_share = shift, share
    return best_shift if best_share >= _DECODED_MIN_SHARE else None


class IngestService:
    def __init__(self, rag: RagService, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.rag = rag
        self.settings.raw_dir.mkdir(parents=True, exist_ok=True)
        self.settings.processed_dir.mkdir(parents=True, exist_ok=True)


    def chunk(self, text: str) -> list[str]:
        words = text.split()
        if not words:
            return []
        size = self.settings.chunk_size
        step = max(size - self.settings.chunk_overlap, 1)
        return [" ".join(words[i : i + size]) for i in range(0, len(words), step)]


    def ingest_pdf(self, path: Path) -> int:
        doc_id = path.stem
        reader = PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]

        shift = detect_shift("\n".join(pages))
        if shift is not None:
            logger.warning(
                "%s: shifted font encoding, text restored with shift %+d",
                path.name,
                shift,
            )
            pages = [shift_text(text, shift) for text in pages]

        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict] = []

        for page_number, text in enumerate(pages, start=1):
            for idx, chunk in enumerate(self.chunk(text.strip())):
                digest = hashlib.sha1(chunk.encode("utf-8")).hexdigest()[:10]
                ids.append(f"{doc_id}-p{page_number}-c{idx}-{digest}")
                documents.append(chunk)
                metadatas.append(
                    {"doc_id": doc_id, "source": path.name, "page": page_number}
                )

        self.rag.collection.delete(where={"source": path.name})

        if not documents:
            logger.warning("No text extracted from %s (possibly a scan that needs OCR)", path.name)
            return 0

        self.rag.collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
        return len(documents)


    def ingest_csv(self, path: Path) -> Path:
        df = pd.read_csv(path)
        df = df.dropna(how="all").drop_duplicates()
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
        out_path = self.settings.processed_dir / f"{path.stem}.csv"
        df.to_csv(out_path, index=False)
        logger.info("CSV %s → %s (%d rows)", path.name, out_path.name, len(df))
        return out_path


    def run(self, force: bool = False) -> IngestResponse:
        indexed: list[str] = []
        skipped: list[str] = []
        chunks_added = 0

        existing = set()
        if not force:
            got = self.rag.collection.get(include=["metadatas"])
            existing = {m.get("source") for m in got.get("metadatas", []) if m}

        for path in sorted(self.settings.raw_dir.iterdir()):
            if path.name.startswith("."):
                continue
            if path.suffix.lower() == ".pdf":
                if path.name in existing:
                    skipped.append(path.name)
                    continue
                chunks_added += self.ingest_pdf(path)
                indexed.append(path.name)
            elif path.suffix.lower() == ".csv":
                self.ingest_csv(path)
                indexed.append(path.name)
            else:
                skipped.append(path.name)

        return IngestResponse(
            indexed_files=indexed, skipped_files=skipped, chunks_added=chunks_added
        )
