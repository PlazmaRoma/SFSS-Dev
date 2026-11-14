"""Retrieval релевантных чанков из ChromaDB."""

import logging
from typing import Any

import chromadb
from chromadb.utils import embedding_functions

from app.config import Settings, get_settings
from app.models.schemas import Source
from app.services.keyword_search import KeywordIndex, fuse

logger = logging.getLogger(__name__)


class RagService:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.settings.chroma_db_path.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(path=str(self.settings.chroma_db_path))
        # sentence-transformers работает локально, без проверки обновлений на
        # Hugging Face при каждом запуске. Для первичной загрузки новой модели
        # флаг можно временно отключить через .env.
        try:
            self._embedding_fn = (
                embedding_functions.SentenceTransformerEmbeddingFunction(
                    model_name=self.settings.embedding_model,
                    local_files_only=self.settings.embedding_local_files_only,
                )
            )
        except Exception as exc:
            if not self.settings.embedding_local_files_only:
                raise
            raise RuntimeError(
                f"Embedding model '{self.settings.embedding_model}' is not available "
                "locally. Temporarily set EMBEDDING_LOCAL_FILES_ONLY=false to "
                "download it, then enable offline mode again."
            ) from exc
        self._keyword_index: KeywordIndex | None = None

    @property
    def collection(self) -> chromadb.Collection:
        return self._client.get_or_create_collection(
            name=self.settings.chroma_collection,
            embedding_function=self._embedding_fn,
            metadata={"hnsw:space": "cosine"},
        )

    def ping(self) -> bool:
        try:
            self._client.heartbeat()
            return True
        except Exception:
            logger.warning("ChromaDB недоступна по пути %s", self.settings.chroma_db_path)
            return False

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

        # С фильтрами — только векторный поиск: where у Chroma бывает составным,
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
