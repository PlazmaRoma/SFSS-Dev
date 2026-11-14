"""Своё хранилище фрагментов вместо ChromaDB: поиск, фильтры, запись на диск."""

from pathlib import Path

import numpy as np
import pytest

from app.config import Settings
from app.services import rag_service
from app.services.embedder import EmbeddingModelMissing
from app.services.vector_store import VectorStore, matches

# Слово → направление: «oxygen» и «helium» ортогональны, смесь лежит между ними
AXES = {"oxygen": 0, "helium": 1, "pressure": 2}


def fake_embed(texts: list[str]) -> np.ndarray:
    out = np.zeros((len(texts), 384), dtype=np.float32)
    for row, text in enumerate(texts):
        for word, axis in AXES.items():
            out[row, axis] = text.lower().count(word)
        out[row, 383] = 0.01
    return out


def make_store(path: Path) -> VectorStore:
    store = VectorStore(path, fake_embed)
    store.upsert(
        ids=["a", "b", "c"],
        documents=["oxygen oxygen", "helium", "oxygen helium pressure"],
        metadatas=[
            {"doc_id": "R1", "source": "r1.pdf", "page": 1},
            {"doc_id": "R2", "source": "r2.pdf", "page": 4},
            {"doc_id": "R1", "source": "r1.pdf", "page": 2},
        ],
    )
    return store


def test_query_ranks_by_cosine(tmp_path):
    store = make_store(tmp_path)
    found = store.query(["oxygen"], n_results=2)
    assert found["ids"] == [["a", "c"]]
    assert found["distances"][0][0] == pytest.approx(0.0, abs=1e-3)
    assert found["metadatas"][0][0]["page"] == 1


def test_query_with_filter(tmp_path):
    store = make_store(tmp_path)
    assert store.query(["oxygen"], n_results=5, where={"doc_id": "R2"})["ids"] == [["b"]]
    assert store.query(["oxygen"], where={"doc_id": "R9"})["ids"] == [[]]


def test_filter_operators():
    meta = {"doc_id": "R1", "page": 5}
    assert matches(meta, {"$and": [{"doc_id": "R1"}, {"page": {"$gte": 5}}]})
    assert matches(meta, {"$or": [{"doc_id": "R2"}, {"page": {"$in": [5, 6]}}]})
    assert not matches(meta, {"page": {"$lt": 5}})
    with pytest.raises(ValueError):
        matches(meta, {"page": {"$regex": "5"}})


def test_index_survives_restart(tmp_path):
    make_store(tmp_path)
    again = VectorStore(tmp_path, None)
    assert again.count() == 3
    assert again.get(ids=["b"])["documents"] == ["helium"]


def test_delete_by_source_and_upsert_replaces(tmp_path):
    store = make_store(tmp_path)
    store.delete(where={"source": "r1.pdf"})
    assert store.get()["ids"] == ["b"]
    store.upsert(ids=["b"], documents=["pressure"], metadatas=[{"doc_id": "R2"}])
    assert store.count() == 1
    assert VectorStore(tmp_path, fake_embed).query(["pressure"], 1)["ids"] == [["b"]]


def test_broken_index_is_reported(tmp_path):
    make_store(tmp_path)
    np.save(tmp_path / "vectors.npy", np.zeros((1, 384), dtype=np.float32))
    with pytest.raises(RuntimeError, match="ingest_documents.py --force"):
        VectorStore(tmp_path, None)


def test_rag_reads_index_without_model(tmp_path):
    make_store(tmp_path / "index")
    rag = rag_service.RagService(
        Settings(index_dir=tmp_path / "index", embedding_dir=tmp_path / "none")
    )
    # Счёт, список и поиск по словам работают и без модели
    assert rag.count() == 3
    assert rag.ping() is True
    assert rag.keyword_index().search("helium", 1) == ["b"]
    # А векторный поиск говорит, что делать
    with pytest.raises(EmbeddingModelMissing, match="python -m app.services.embedder"):
        rag.retrieve("helium")


def test_rag_hybrid_search_uses_both(tmp_path, monkeypatch):
    make_store(tmp_path / "index")
    rag = rag_service.RagService(Settings(index_dir=tmp_path / "index"))
    monkeypatch.setattr(rag, "_embed", fake_embed)
    rag._store._embed = fake_embed
    sources = rag.retrieve("helium", top_k=2)
    assert [s.doc_id for s in sources] == ["R2", "R1"]
    assert sources[0].page == 4
