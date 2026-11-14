"""Парсинг и индексация документов из data/raw (раздел 5 ТЗ)."""

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

# --- восстановление сдвинутой кодировки ------------------------------------
#
# Бывают PDF со шрифтами Type0/Identity-H без таблицы ToUnicode, у которых и во
# встроенном шрифте нет cmap. Тогда pypdf отдаёт вместо букв номера глифов, и
# если глифы в подмножестве шрифта шли по порядку ASCII, текст сдвинут на
# константу: в FLEX-отчёте (NTRS-20120015928) «FLEX» читается как «*0)<», сдвиг
# −28. Из самого PDF правильное соответствие не восстановить, но сдвиг легко
# найти перебором: у нормального английского текста ~20–30 % слов служебные,
# у сдвинутого — ноль.

# Без однобуквенного «a»: при «чужом» сдвиге текст рассыпается на одиночные
# буквы, и «a» среди них набирало бы очки.
_STOPWORDS = frozenset(
    "the of and to in is for that with on as by are was be this from at or an "
    "it which were have has not can".split()
)
_WORD_RE = re.compile(r"[A-Za-z]+")
# Пробелы и переводы строк pypdf вставляет сам по геометрии страницы — это не
# глифы шрифта, их не сдвигаем. Оборотная сторона: глифы, чей номер совпал с
# кодом пробела или перевода строки («<» и «&» при сдвиге 28), теряются.
_LAYOUT_CHARS = frozenset(" \n")
_DETECT_SAMPLE_CHARS = 20_000
_DETECT_MIN_WORDS = 200
_GARBLED_MAX_SHARE = 0.05
_DECODED_MIN_SHARE = 0.15
# Верный сдвиг переводит почти все символы в печатный ASCII (в FLEX за его
# пределами остались ~0.1 % — лигатуры и кавычки). Сдвиг, выбрасывающий больше,
# заведомо не тот, как бы он ни набирал служебные слова.
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
    """Сдвигает коды символов на shift.

    Символ, который после сдвига не попадает в печатный ASCII, — глиф без
    восстановимого соответствия (лигатуры fi/fl, типографские кавычки, градус,
    значки сносок). Угадывать его не берёмся и ставим пробел.
    """
    out = []
    for ch in text:
        if ch in _LAYOUT_CHARS:
            out.append(ch)
            continue
        code = ord(ch) + shift
        out.append(chr(code) if 0x20 <= code <= 0x7E else " ")
    return "".join(out)


def detect_shift(text: str) -> int | None:
    """Сдвиг кодировки, если текст выглядит сдвинутым английским, иначе None.

    Решение принимается по образцу из начала документа, а не постранично:
    кодировка — свойство шрифтов, а на коротких страницах и таблицах доля
    служебных слов шумит. Перебор запускается, только если в исходном тексте
    служебных слов почти нет, так что нормальные документы проходят за один
    regex.
    """
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

    # --- чанкинг ---------------------------------------------------------

    def chunk(self, text: str) -> list[str]:
        """Чанки ~chunk_size слов с перекрытием chunk_overlap.

        Приближение по словам, а не по токенам: для MVP достаточно, при
        необходимости заменить на tiktoken/токенизатор эмбеддера.
        """
        words = text.split()
        if not words:
            return []
        size = self.settings.chunk_size
        step = max(size - self.settings.chunk_overlap, 1)
        return [" ".join(words[i : i + size]) for i in range(0, len(words), step)]

    # --- PDF -------------------------------------------------------------

    def ingest_pdf(self, path: Path) -> int:
        doc_id = path.stem
        reader = PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]

        shift = detect_shift("\n".join(pages))
        if shift is not None:
            logger.warning(
                "%s: кодировка шрифтов сдвинута, текст восстановлен сдвигом %+d",
                path.name,
                shift,
            )
            pages = [shift_text(text, shift) for text in pages]

        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict] = []

        # strip() только после сдвига: управляющие символы \x1c–\x1f Python
        # считает пробельными, а в сдвинутом тексте это цифры 8, 9 и «:», «;».
        for page_number, text in enumerate(pages, start=1):
            for idx, chunk in enumerate(self.chunk(text.strip())):
                digest = hashlib.sha1(chunk.encode("utf-8")).hexdigest()[:10]
                ids.append(f"{doc_id}-p{page_number}-c{idx}-{digest}")
                documents.append(chunk)
                metadatas.append(
                    {"doc_id": doc_id, "source": path.name, "page": page_number}
                )

        # В ID чанка входит хеш текста, поэтому при изменившемся извлечении
        # upsert не перезапишет старые чанки, а добавит новые рядом. Убираем
        # прежнюю версию документа целиком.
        self.rag.collection.delete(where={"source": path.name})

        if not documents:
            logger.warning("Из %s не извлечён текст (возможно, скан — нужен OCR)", path.name)
            return 0

        self.rag.collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
        return len(documents)

    # --- CSV -------------------------------------------------------------

    def ingest_csv(self, path: Path) -> Path:
        """Очистка и приведение типов, результат — в data/processed."""
        df = pd.read_csv(path)
        df = df.dropna(how="all").drop_duplicates()
        df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
        out_path = self.settings.processed_dir / f"{path.stem}.parquet"
        df.to_parquet(out_path, index=False)
        logger.info("CSV %s → %s (%d строк)", path.name, out_path.name, len(df))
        return out_path

    # --- оркестрация -----------------------------------------------------

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
