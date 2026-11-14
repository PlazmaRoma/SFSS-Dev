"""Хранилище фрагментов с векторами: два файла на диске вместо ChromaDB.

В корпусе 1131 фрагмент по 384 числа, 1,7 МБ. Точный перебор по такой матрице numpy
делает за миллисекунды, так что приближённый HNSW из ChromaDB ничего не давал, а сама
ChromaDB тянула в установку kubernetes, grpc и opentelemetry (ARCHITECTURE § 7.23).

Методы повторяют ту часть API коллекции Chroma, которой пользуется сервис: get, query,
upsert, delete, count. Поэтому остальной код и тесты с подделкой коллекции не менялись.

Файлы: chunks.jsonl (id, текст, метаданные, по строке на фрагмент) и vectors.npy
(float32, в том же порядке). Оба лежат в git: готовый индекс не надо собирать при
установке. Запись атомарная: сначала во временный файл, потом замена.
"""

import json
import os
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

CHUNKS = "chunks.jsonl"
VECTORS = "vectors.npy"
DIMENSIONS = 384

Embed = Callable[[list[str]], np.ndarray]


def matches(meta: dict, where: dict | None) -> bool:
    """Фильтр как where у Chroma: поле = значение, $eq, $ne, $in, $nin, $and, $or."""
    if not where:
        return True
    for key, condition in where.items():
        if key == "$and":
            if not all(matches(meta, part) for part in condition):
                return False
            continue
        if key == "$or":
            if not any(matches(meta, part) for part in condition):
                return False
            continue
        value = meta.get(key)
        if isinstance(condition, dict):
            for op, expected in condition.items():
                ok = {
                    "$eq": lambda: value == expected,
                    "$ne": lambda: value != expected,
                    "$in": lambda: value in expected,
                    "$nin": lambda: value not in expected,
                    "$gt": lambda: value is not None and value > expected,
                    "$gte": lambda: value is not None and value >= expected,
                    "$lt": lambda: value is not None and value < expected,
                    "$lte": lambda: value is not None and value <= expected,
                }.get(op)
                if ok is None:
                    raise ValueError(f"Unsupported filter operator: {op}")
                if not ok():
                    return False
        elif value != condition:
            return False
    return True


class VectorStore:
    def __init__(self, path: Path, embed: Embed | None) -> None:
        self.path = path
        self._embed = embed
        self._lock = threading.Lock()
        self.ids: list[str] = []
        self.documents: list[str] = []
        self.metadatas: list[dict] = []
        self.vectors = np.zeros((0, DIMENSIONS), dtype=np.float32)
        self._load()

    # --- диск ----------------------------------------------------------------

    def _load(self) -> None:
        chunks, vectors = self.path / CHUNKS, self.path / VECTORS
        if not chunks.is_file() or not vectors.is_file():
            return
        rows = [json.loads(line) for line in chunks.read_text(encoding="utf-8").splitlines() if line]
        matrix = np.load(vectors).astype(np.float32)
        if len(rows) != len(matrix):
            raise RuntimeError(
                f"Index in {self.path} is broken: {len(rows)} chunks, {len(matrix)} vectors. "
                "Rebuild it: python scripts/ingest_documents.py --force"
            )
        self.ids = [row["id"] for row in rows]
        self.documents = [row["document"] for row in rows]
        self.metadatas = [row["metadata"] for row in rows]
        self.vectors = matrix

    def _save(self) -> None:
        self.path.mkdir(parents=True, exist_ok=True)
        lines = (
            json.dumps({"id": i, "document": d, "metadata": m}, ensure_ascii=False)
            for i, d, m in zip(self.ids, self.documents, self.metadatas)
        )
        self._write(CHUNKS, lambda file: file.write(("\n".join(lines) + "\n").encode("utf-8")))
        self._write(VECTORS, lambda file: np.save(file, self.vectors))

    def _write(self, name: str, writer: Callable) -> None:
        fd, temp = tempfile.mkstemp(dir=self.path, prefix=f".{name}.")
        try:
            with os.fdopen(fd, "wb") as file:
                writer(file)
            # mkstemp создаёт файл только для владельца, а индекс читают все
            umask = os.umask(0)
            os.umask(umask)
            os.chmod(temp, 0o666 & ~umask)
            os.replace(temp, self.path / name)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)

    # --- векторы ------------------------------------------------------------

    def embed(self, texts: list[str]) -> np.ndarray:
        if self._embed is None:
            raise RuntimeError("No embedding model: this store is read-only")
        return np.asarray(self._embed(texts), dtype=np.float32)

    @staticmethod
    def _normalize(matrix: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        return matrix / np.clip(norms, 1e-12, None)

    # --- API коллекции ---------------------------------------------------------

    def count(self) -> int:
        return len(self.ids)

    def get(
        self,
        ids: list[str] | None = None,
        where: dict | None = None,
        include: list[str] | None = None,
    ) -> dict[str, Any]:
        positions = range(len(self.ids))
        if ids is not None:
            wanted = set(ids)
            positions = [i for i in positions if self.ids[i] in wanted]
        positions = [i for i in positions if matches(self.metadatas[i], where)]
        return {
            "ids": [self.ids[i] for i in positions],
            "documents": [self.documents[i] for i in positions],
            "metadatas": [self.metadatas[i] for i in positions],
        }

    def query(
        self,
        query_texts: list[str],
        n_results: int = 10,
        where: dict | None = None,
        include: list[str] | None = None,
    ) -> dict[str, list]:
        """Ближайшие по косинусу, как у коллекции Chroma с hnsw:space=cosine."""
        result: dict[str, list] = {"ids": [], "documents": [], "metadatas": [], "distances": []}
        allowed = np.array([matches(m, where) for m in self.metadatas], dtype=bool)
        if not allowed.any():
            for key in result:
                result[key] = [[] for _ in query_texts]
            return result
        corpus = self._normalize(self.vectors)
        for query in self._normalize(self.embed(query_texts)):
            similarity = corpus @ query
            similarity[~allowed] = -np.inf
            n = min(n_results, int(allowed.sum()))
            top = np.argsort(-similarity, kind="stable")[:n]
            result["ids"].append([self.ids[i] for i in top])
            result["documents"].append([self.documents[i] for i in top])
            result["metadatas"].append([self.metadatas[i] for i in top])
            result["distances"].append([float(1.0 - similarity[i]) for i in top])
        return result

    def upsert(self, ids: list[str], documents: list[str], metadatas: list[dict]) -> None:
        vectors = self.embed(documents)
        with self._lock:
            position = {chunk_id: i for i, chunk_id in enumerate(self.ids)}
            fresh = []
            for chunk_id, text, meta, vector in zip(ids, documents, metadatas, vectors):
                if chunk_id in position:
                    i = position[chunk_id]
                    self.documents[i], self.metadatas[i], self.vectors[i] = text, meta, vector
                else:
                    fresh.append((chunk_id, text, meta, vector))
            if fresh:
                self.ids += [row[0] for row in fresh]
                self.documents += [row[1] for row in fresh]
                self.metadatas += [row[2] for row in fresh]
                self.vectors = np.vstack([self.vectors, np.array([row[3] for row in fresh])])
            self._save()

    def delete(self, ids: list[str] | None = None, where: dict | None = None) -> None:
        with self._lock:
            drop = set(self.get(ids=ids, where=where)["ids"]) if (ids or where) else set()
            if not drop:
                return
            keep = [i for i, chunk_id in enumerate(self.ids) if chunk_id not in drop]
            self.ids = [self.ids[i] for i in keep]
            self.documents = [self.documents[i] for i in keep]
            self.metadatas = [self.metadatas[i] for i in keep]
            self.vectors = self.vectors[keep]
            self._save()
