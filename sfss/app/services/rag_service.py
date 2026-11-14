"""Retrieval релевантных чанков: свой индекс на диске и модель поиска в ONNX."""

import logging
import threading
from typing import Any

import numpy as np

from app.config import Settings, get_settings
from app.models.schemas import Source
from app.services.embedder import Embedder
from app.services.keyword_search import KeywordIndex, fuse
from app.services.vector_store import VectorStore

logger = logging.getLogger(__name__)


class RagService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._embedder: Embedder | None = None
        self._embedder_lock = threading.Lock()
        self._store = VectorStore(self.settings.index_dir, self._embed)
        self._keyword_index: KeywordIndex | None = None

    def _embed(self, texts: list[str]) -> np.ndarray:
        # Модель грузится при первом вопросе или импорте, а не на старте: так status,
        # расчёт и список отчётов не ждут полторы секунды и работают даже без модели
        with self._embedder_lock:
            if self._embedder is None:
                self._embedder = Embedder(self.settings.embedding_dir)
        return self._embedder.embed(texts)

    def warm_up(self) -> None:
        """Загрузить модель заранее, чтобы первый вопрос не ждал."""
        self._embed(["warm up"])

    @property
    def collection(self) -> VectorStore:
        return self._store

    def ping(self) -> bool:
        return self._store.count() > 0 or (self.settings.index_dir / "chunks.jsonl").exists()

    def count(self) -> int:
        return self.collection.count()

    def keyword_index(self) -> KeywordIndex:
        """Индекс BM25 по всей коллекции; пересобирается, если число чанков изменилось."""
        index = self._keyword_index
        if index is None or len(index.ids) != self.count():
            data = self.collection.get(include=["documents"])
            index = KeywordIndex(data["ids"], data["documents"] or [])
            self._keyword_index = index
        return index

    def retrieve(
        self,
        question: str,
        filters: dict[str, Any] | None = None,
        top_k: int | None = None,
    ) -> list[Source]:
        k = top_k or self.settings.top_k
        if self.count() == 0:
            logger.warning("Коллекция пуста — сначала выполните ingest")
            return []

        # С фильтрами — только векторный поиск: where бывает составным,
        # повторять его логику в BM25 незачем.
        if self.settings.hybrid_search and not filters:
            n = min(self.settings.hybrid_candidates, self.count())
            dense = self.collection.query(query_texts=[question], n_results=n)["ids"][0]
            keyword = self.keyword_index().search(question, n)
            ids = fuse(dense, keyword, self.settings.keyword_weight, k)
            result = self.collection.get(ids=ids, include=["documents", "metadatas"])
            # get возвращает в своём порядке, а нужен порядок слияния
            found = dict(zip(result["ids"], zip(result["documents"], result["metadatas"])))
            documents = [found[i][0] for i in ids if i in found]
            metadatas = [found[i][1] for i in ids if i in found]
        else:
            result = self.collection.query(
                query_texts=[question],
                n_results=k,
                where=filters or None,
            )
            documents = result.get("documents", [[]])[0]
            metadatas = result.get("metadatas", [[]])[0]

        sources: list[Source] = []
        for text, meta in zip(documents, metadatas):
            meta = meta or {}
            page = meta.get("page")
            sources.append(
                Source(
                    doc_id=str(meta.get("doc_id", "unknown")),
                    excerpt=text,
                    page=int(page) if page is not None else None,
                )
            )
        return sources
