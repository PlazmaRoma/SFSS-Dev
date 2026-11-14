import os
from pathlib import Path

import pytest

from app.config import Settings, apply_offline_mode
from app.services import rag_service


class FakeClient:
    pass


def _settings(tmp_path: Path, *, local_only: bool) -> Settings:
    return Settings(
        chroma_db_path=tmp_path / "chroma",
        embedding_local_files_only=local_only,
    )


def test_embedding_uses_local_cache_by_default(monkeypatch, tmp_path):
    captured = {}

    monkeypatch.setattr(rag_service.chromadb, "PersistentClient", lambda **_: FakeClient())

    def fake_embedding(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(
        rag_service.embedding_functions,
        "SentenceTransformerEmbeddingFunction",
        fake_embedding,
    )

    rag_service.RagService(settings=_settings(tmp_path, local_only=True))

    assert captured["local_files_only"] is True


def test_online_download_can_be_enabled(monkeypatch, tmp_path):
    captured = {}

    monkeypatch.setattr(rag_service.chromadb, "PersistentClient", lambda **_: FakeClient())

    def fake_embedding(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(
        rag_service.embedding_functions,
        "SentenceTransformerEmbeddingFunction",
        fake_embedding,
    )

    rag_service.RagService(settings=_settings(tmp_path, local_only=False))

    assert captured["local_files_only"] is False


def test_missing_local_model_has_actionable_error(monkeypatch, tmp_path):
    monkeypatch.setattr(rag_service.chromadb, "PersistentClient", lambda **_: FakeClient())

    def fail_embedding(**_):
        raise OSError("cache miss")

    monkeypatch.setattr(
        rag_service.embedding_functions,
        "SentenceTransformerEmbeddingFunction",
        fail_embedding,
    )

    with pytest.raises(RuntimeError, match="EMBEDDING_LOCAL_FILES_ONLY=false"):
        rag_service.RagService(settings=_settings(tmp_path, local_only=True))


def test_hub_offline_mode_enabled_with_local_cache(monkeypatch, tmp_path):
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)

    apply_offline_mode(_settings(tmp_path, local_only=True))

    assert os.environ["HF_HUB_OFFLINE"] == "1"


def test_hub_offline_mode_left_alone_for_download(monkeypatch, tmp_path):
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)

    apply_offline_mode(_settings(tmp_path, local_only=False))

    assert "HF_HUB_OFFLINE" not in os.environ


def test_explicit_hub_offline_value_is_respected(monkeypatch, tmp_path):
    monkeypatch.setenv("HF_HUB_OFFLINE", "0")

    apply_offline_mode(_settings(tmp_path, local_only=True))

    assert os.environ["HF_HUB_OFFLINE"] == "0"
