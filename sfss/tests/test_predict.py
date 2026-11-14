from app.services.ml_service import FEATURE_DEFAULTS, MLService


def test_predict_happy_path(client):
    response = client.post(
        "/predict",
        json={"parameters": {"oxygen_level": 0.21, "gravity": 0.0}},
    )
    assert response.status_code == 200

    body = response.json()
    assert 0.0 <= body["risk_score"] <= 1.0
    assert body["cluster"] == 2
    assert len(body["chart_data"]["x"]) == len(body["chart_data"]["y"])
    assert body["is_heuristic"] is False


def test_predict_accepts_empty_parameters(client):
    """Контракт смягчён: без параметров берутся значения по умолчанию."""
    assert client.post("/predict", json={}).status_code == 200


# --- resolve() проверяется напрямую: это чистая логика, модель ей не нужна ---


def _service(features: list[str]) -> MLService:
    service = MLService()
    service._bundle = {"features": features}
    return service


def test_resolve_fills_missing_from_defaults():
    service = _service(["oxygen_level", "n2", "pressure_mmhg"])

    resolved, applied = service.resolve({"oxygen_level": 0.30})

    assert resolved["oxygen_level"] == 0.30          # переданное не трогаем
    assert resolved["n2"] == FEATURE_DEFAULTS["n2"]
    assert sorted(applied) == ["n2", "pressure_mmhg"]


def test_resolve_reports_nothing_when_all_given():
    service = _service(["oxygen_level", "n2"])

    _, applied = service.resolve({"oxygen_level": 0.3, "n2": 0.7})

    assert applied == []


def test_resolve_rejects_unknown_parameter():
    """Опечатка не должна молча подмениться значением по умолчанию."""
    service = _service(["oxygen_level"])

    try:
        service.resolve({"oxigen_level": 0.30})
    except ValueError as exc:
        assert "oxigen_level" in str(exc)
    else:
        raise AssertionError("неизвестный параметр должен отвергаться")


def test_resolve_requires_feature_without_default():
    service = _service(["oxygen_level", "unknown_feature"])

    try:
        service.resolve({})
    except ValueError as exc:
        assert "unknown_feature" in str(exc)
    else:
        raise AssertionError("признак без значения по умолчанию обязан требоваться")
