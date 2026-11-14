"""Векторы для поиска по отчётам: модель в ONNX, без PyTorch.

Модель та же, что была с sentence-transformers: paraphrase-multilingual-MiniLM-L12-v2,
русский вопрос находит английский текст. Только запускается через onnxruntime, а веса
сжаты до int8. Ради этого из установки ушёл PyTorch с transformers, около гигабайта,
а модель весит 113 МБ вместо 470 (ARCHITECTURE § 7.23).

Модель качается один раз: `python -m app.services.embedder`. Дальше работает без сети.
"""

import hashlib
import logging
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

REPO = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
# Ревизия закреплена: индекс в git посчитан именно этой моделью, и тихое обновление
# на Hugging Face разошлось бы с ним
REVISION = "2c4055b12046f11709e9df2c122e59ffbdc2f900"
FILES = {
    # имя на диске: (путь в репозитории, sha256)
    "model.onnx": (
        "onnx/model_quantized.onnx",
        "66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc",
    ),
    "tokenizer.json": (
        "tokenizer.json",
        "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441",
    ),
}
# Как у sentence-transformers для этой модели: дальше 128 токенов текст не читается
MAX_TOKENS = 128
BATCH = 32


class EmbeddingModelMissing(RuntimeError):
    """Модели нет на диске: её не скачали при установке."""


def model_ready(model_dir: Path) -> bool:
    return all((model_dir / name).is_file() for name in FILES)


class Embedder:
    """Текст → вектор 384 чисел. Средний вектор токенов, как в sentence-transformers."""

    def __init__(self, model_dir: Path) -> None:
        if not model_ready(model_dir):
            raise EmbeddingModelMissing(
                f"Embedding model is not in {model_dir}. "
                "Download it once: python -m app.services.embedder"
            )
        import onnxruntime
        from tokenizers import Tokenizer

        self.tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=MAX_TOKENS)
        self.tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
        options = onnxruntime.SessionOptions()
        options.log_severity_level = 3
        self.session = onnxruntime.InferenceSession(
            str(model_dir / "model.onnx"), options, providers=["CPUExecutionProvider"]
        )
        self.inputs = {item.name for item in self.session.get_inputs()}

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, 384), dtype=np.float32)
        parts = [self._batch(texts[i : i + BATCH]) for i in range(0, len(texts), BATCH)]
        return np.vstack(parts)

    def _batch(self, texts: list[str]) -> np.ndarray:
        encoded = self.tokenizer.encode_batch(texts)
        ids = np.array([e.ids for e in encoded], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.inputs:
            feed["token_type_ids"] = np.zeros_like(ids)
        hidden = self.session.run(None, feed)[0]
        weights = mask[..., None].astype(np.float32)
        summed = (hidden * weights).sum(axis=1)
        return (summed / np.clip(weights.sum(axis=1), 1e-9, None)).astype(np.float32)


# --- Загрузка ------------------------------------------------------------------


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def download(model_dir: Path, show_progress: bool = True) -> None:
    """Скачивает модель с Hugging Face, проверяет контрольные суммы. Готовые файлы пропускает."""
    import httpx

    model_dir.mkdir(parents=True, exist_ok=True)
    for name, (remote, expected) in FILES.items():
        target = model_dir / name
        if target.is_file() and _sha256(target) == expected:
            continue
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{remote}"
        fd, temp = tempfile.mkstemp(dir=model_dir, prefix=f".{name}.")
        try:
            with os.fdopen(fd, "wb") as out, httpx.stream(
                "GET", url, follow_redirects=True, timeout=httpx.Timeout(60.0, connect=15.0)
            ) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length", 0))
                done = 0
                for chunk in response.iter_bytes(1 << 16):
                    out.write(chunk)
                    done += len(chunk)
                    if show_progress and total:
                        percent = done * 100 // total
                        print(
                            f"\r    {name}: {done >> 20} of {total >> 20} MB, {percent}%",
                            end="", file=sys.stderr, flush=True,
                        )
            if show_progress:
                print(file=sys.stderr)
            if _sha256(Path(temp)) != expected:
                raise RuntimeError(f"{name}: checksum mismatch, download again")
            os.replace(temp, target)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)


if __name__ == "__main__":
    from app.config import get_settings

    folder = get_settings().embedding_dir
    if model_ready(folder) and all(_sha256(folder / n) == s for n, (_, s) in FILES.items()):
        print(f"    already on disk: {folder}")
    else:
        download(folder)
        print(f"    downloaded: {folder}")
