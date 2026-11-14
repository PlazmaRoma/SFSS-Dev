from app.services.keyword_search import KeywordIndex, fuse, tokenize

DOCS = {
    "helium": "Flame extinction occurred at 21% oxygen with helium diluted atmosphere.",
    "pressure": "Droplet burning at reduced pressure of 0.7 atm extends the burning time.",
    "flow": "Air flow velocity controls flame spread over thin fuels.",
    "ams": "The detector searches for dark matter and antimatter in cosmic rays.",
}


def _index() -> KeywordIndex:
    return KeywordIndex(list(DOCS), list(DOCS.values()))


def test_tokenize_drops_question_words_and_keeps_hyphenated_terms():
    assert tokenize("How does BASS-II affect the flame?") == ["bass-ii", "affect", "flame"]


def test_search_finds_exact_term():
    assert _index().search("How does helium affect combustion?", 2)[0] == "helium"


def test_search_skips_documents_without_query_words():
    assert _index().search("helium", 4) == ["helium"]


def test_fuse_prefers_documents_found_by_both():
    dense = ["flow", "pressure", "helium"]
    keyword = ["ams", "pressure", "helium"]
    assert fuse(dense, keyword, keyword_weight=1.5, k=2) == ["pressure", "helium"]


def test_fuse_keyword_weight_breaks_ties_toward_keywords():
    assert fuse(["a"], ["b"], keyword_weight=1.5, k=2) == ["b", "a"]
    assert fuse(["a"], ["b"], keyword_weight=0.5, k=2) == ["a", "b"]
