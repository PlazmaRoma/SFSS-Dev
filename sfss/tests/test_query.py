def test_query_returns_answer_with_sources(client):
    response = client.post("/query", json={"question": "Как кислород влияет на горение?"})
    assert response.status_code == 200

    body = response.json()
    assert body["answer"]
    assert len(body["sources"]) == 1
    assert body["sources"][0]["doc_id"] == "BASS-II-report"
    assert body["sources"][0]["page"] == 4


def test_query_rejects_empty_question(client):
    response = client.post("/query", json={"question": ""})
    assert response.status_code == 422


def test_language_goes_to_llm_not_to_search(client):
    from tests.conftest import FakeLLMService, FakeRagService

    question = "Как кислород влияет на горение?"
    response = client.post("/query", json={"question": question, "language": "en"})
    assert response.status_code == 200

    # Поиск видит только перевод вопроса: любой лишний текст в нём уводит retrieval
    assert FakeRagService.last_question == f"translated: {question}"
    # А модель отвечает на исходный вопрос; перевод ей передаётся отдельно
    assert FakeLLMService.last_call == {
        "question": question,
        "language": "en",
        "english_question": f"translated: {question}",
    }
    assert response.json()["search_query"] == f"translated: {question}"


def test_english_question_searched_as_is(client):
    from tests.conftest import FakeRagService

    response = client.post("/query", json={"question": "What is BASS-II?"})
    assert FakeRagService.last_question == "What is BASS-II?"
    assert response.json()["search_query"] is None


def test_language_is_optional(client):
    from tests.conftest import FakeLLMService

    response = client.post("/query", json={"question": "Что такое BASS-II?"})
    assert response.status_code == 200
    assert FakeLLMService.last_call["language"] is None


def test_unknown_language_rejected(client):
    response = client.post("/query", json={"question": "Что такое BASS-II?", "language": "de"})
    assert response.status_code == 422


def _events(response):
    import json

    return [json.loads(line) for line in response.text.splitlines()]


def test_stream_sends_sources_first_then_text_then_done(client):
    response = client.post("/query/stream", json={"question": "Как кислород влияет на горение?", "language": "ru"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    events = _events(response)
    assert events[0]["type"] == "sources"
    assert events[0]["sources"][0]["doc_id"] == "BASS-II-report"
    assert events[0]["search_query"] == "translated: Как кислород влияет на горение?"
    assert [e["type"] for e in events[1:]] == ["stage", "delta", "delta", "done"]
    assert events[-1]["answer"] == "Скорость падает ниже 18% O2."


def test_stream_reports_llm_failure_as_event(client):
    from tests.conftest import FakeLLMService

    FakeLLMService.fail_midstream = True
    try:
        events = _events(client.post("/query/stream", json={"question": "Why?"}))
    finally:
        FakeLLMService.fail_midstream = False
    assert events[-1]["type"] == "error"
    assert "done" not in [e["type"] for e in events]
