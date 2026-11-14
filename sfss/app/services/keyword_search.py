"""Поиск по словам (BM25) и слияние с векторным поиском (RRF).

Векторный поиск MiniLM промахивается мимо фрагментов с конкретным термином:
в корпусе 25 фрагментов про гелий, а на вопрос «как гелий влияет на горение»
топ-3 не находил ни одного. BM25 цепляется за само слово, но сам по себе
путается на общих словах: на «why does droplet size matter» он нашёл детектор
частиц AMS-02 (dark matter). Слияние берёт лучшее из обоих: наверх выходит то,
что нашли оба способа. Замер — ARCHITECTURE § 7.13.
"""

import math
import re
from collections import Counter

# Служебные слова вопроса: без них BM25 ищет «does» и «what» наравне с терминами
STOP_WORDS = frozenset(
    "a an the of in on at to for and or is are was were be been by with as from "
    "that this these those what how why when where which who does do did it its "
    "into about can could should would".split()
)
TOKEN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def tokenize(text: str) -> list[str]:
    return [w for w in TOKEN.findall(text.lower()) if len(w) > 1 and w not in STOP_WORDS]


class KeywordIndex:
    """BM25 по фрагментам корпуса. 1131 фрагмент индексируется за доли секунды."""

    def __init__(self, ids: list[str], documents: list[str], k1: float = 1.5, b: float = 0.75):
        self.ids = ids
        self._terms = [Counter(tokenize(d)) for d in documents]
        self._lengths = [sum(c.values()) for c in self._terms]
        self._avg_length = (sum(self._lengths) / len(self._lengths)) if ids else 0.0
        df = Counter(w for c in self._terms for w in c)
        n = len(ids)
        self._idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}
        self.k1, self.b = k1, b

    def search(self, query: str, n: int) -> list[str]:
        """id фрагментов по убыванию BM25; фрагменты без единого слова запроса не попадают."""
        words = set(tokenize(query))
        scored = []
        for i, terms in enumerate(self._terms):
            score = 0.0
            for w in words:
                f = terms.get(w)
                if f:
                    norm = 1 - self.b + self.b * self._lengths[i] / self._avg_length
                    score += self._idf[w] * f * (self.k1 + 1) / (f + self.k1 * norm)
            if score > 0:
                scored.append((score, i))
        scored.sort(key=lambda x: -x[0])
        return [self.ids[i] for _, i in scored[:n]]


def fuse(dense: list[str], keyword: list[str], keyword_weight: float, k: int, c: int = 60) -> list[str]:
    """Reciprocal rank fusion: сумма весов 1/(c + место) по обоим спискам."""
    score: Counter[str] = Counter()
    for rank, doc_id in enumerate(dense):
        score[doc_id] += 1 / (c + rank + 1)
    for rank, doc_id in enumerate(keyword):
        score[doc_id] += keyword_weight / (c + rank + 1)
    return [doc_id for doc_id, _ in score.most_common(k)]
