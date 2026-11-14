from app.services.dashboard_service import DATASET_SOURCE, TARGET_UNITS


def _is_ascii(value: str) -> bool:
    return value.isascii()


def test_units_are_ascii():
    for target, unit in TARGET_UNITS.items():
        assert _is_ascii(unit), f"единицы '{unit}' для {target} содержат не-ASCII"


def test_dataset_source_is_ascii():
    assert _is_ascii(DATASET_SOURCE)


def test_units_avoid_superscripts():
    for unit in TARGET_UNITS.values():
        assert "²" not in unit and "³" not in unit


def test_dashboard_payload_is_ascii(client):
    body = client.get("/dashboard").text
    non_ascii = {ch for ch in body if not ch.isascii()}
    assert not non_ascii, f"в ответе /dashboard не-ASCII символы: {non_ascii}"
