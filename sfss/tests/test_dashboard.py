def test_dashboard_returns_all_sections(client):
    response = client.get("/dashboard")
    assert response.status_code == 200

    body = response.json()
    assert set(body) == {"model", "dataset", "corpus"}


def test_dashboard_model_carries_units_and_metrics(client):
    body = client.get("/dashboard").json()["model"]

    # без единиц измерения число на экране нечитаемо, но сама подпись — в ASCII:
    # это данные для чужого кода, а не текст для человека
    assert body["units"] == "mm^2/s"
    assert body["target"] == "burn_rate_mm2s"
    assert body["trained"] is True
    assert body["metrics"]["r2"] > 0


def test_dashboard_experiments_are_plottable(client):
    dataset = client.get("/dashboard").json()["dataset"]

    assert dataset["rows"] == len(dataset["experiments"])
    point = dataset["experiments"][0]
    assert point["oxygen_level"] is not None
    assert point["burn_rate_mm2s"] is not None
