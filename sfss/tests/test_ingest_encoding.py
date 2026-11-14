from pathlib import Path

from app.config import Settings
from app.services import ingest_service
from app.services.ingest_service import IngestService, detect_shift, shift_text

ENGLISH = (
    "Stemming from the need to prevent, detect and suppress on-board spacecraft "
    "fires, the NASA microgravity combustion research program has grown to include "
    "fundamental research. From early experiments we have known that flames behave "
    "differently in microgravity, and this environment would provide an ideal "
    "laboratory for refining many of the long held principles of combustion science. "
) * 6


def garble(text: str, shift: int = 28) -> str:
    return "".join(chr(ord(ch) - shift) for ch in text)


def test_shift_text_decodes_real_flex_title() -> None:
    raw = "*0)<\x1e\x04%\x04()'-7-:)\x0478)4\x04*36;%6(\x04-2\x042%7%"
    assert shift_text(raw, 28) == "FLEX: A DECISIVE STEP FORWARD IN NASA"


def test_shift_text_keeps_layout_and_blanks_unknown_glyphs() -> None:
    assert shift_text("2%7%¬7 *0)<\n", 28) == "NASA S FLEX\n"


def test_detect_shift_finds_garbled_english() -> None:
    assert detect_shift(garble(ENGLISH)) == 28
    assert detect_shift(garble(ENGLISH, shift=3)) == 3


def test_detect_shift_ignores_normal_and_empty_text() -> None:
    assert detect_shift(ENGLISH) is None
    assert detect_shift("") is None
    assert detect_shift("FLEX-001 0.21 0.52 1.06 extinction\n" * 100) is None


class FakePage:
    def __init__(self, text: str) -> None:
        self.text = text

    def extract_text(self) -> str:
        return self.text


class FakeCollection:
    def __init__(self) -> None:
        self.deleted: list[dict] = []
        self.documents: list[str] = []

    def delete(self, where: dict) -> None:
        self.deleted.append(where)

    def upsert(self, ids, documents, metadatas) -> None:
        self.documents.extend(documents)


class FakeRag:
    def __init__(self) -> None:
        self.collection = FakeCollection()


def test_ingest_pdf_repairs_text_and_replaces_old_chunks(tmp_path: Path, monkeypatch) -> None:
    pages = [FakePage(garble(ENGLISH)), FakePage(garble(ENGLISH))]
    monkeypatch.setattr(
        ingest_service, "PdfReader", lambda _path: type("R", (), {"pages": pages})
    )
    rag = FakeRag()
    service = IngestService(rag, Settings(raw_dir=tmp_path, processed_dir=tmp_path))

    assert service.ingest_pdf(tmp_path / "flex.pdf") > 0
    assert rag.collection.deleted == [{"source": "flex.pdf"}]
    assert rag.collection.documents[0].startswith("Stemming from the need")


def test_csv_goes_to_processed_as_csv(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    raw.mkdir()
    (raw / "Runs.csv").write_text("Oxygen Level,N2\n0.3,0.7\n0.3,0.7\n,\n")
    service = IngestService(FakeRag(), Settings(raw_dir=raw, processed_dir=tmp_path / "out"))
    out = service.ingest_csv(raw / "Runs.csv")
    assert out.name == "Runs.csv"
    assert out.read_text().splitlines() == ["oxygen_level,n2", "0.3,0.7"]
