def test_health_ok(client):
    response = client.get("/health")
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "ok"
    assert body["chroma"] is True
    assert body["lm_studio"] is True
    assert body["indexed_documents"] == 3
    assert body["model_loaded"] is True
    assert body["model_context_length"] == 8192
