"""Сторож: значения, уходящие клиенту, должны быть в ASCII.

Правило проекта — русский для людей, ASCII для машин. Текст, который читает
человек (документация, комментарии, логи, системный промпт LLM), остаётся
русским. Всё, что пересекает границу API как данные или контракт, — нет:
это разбирает чужой код, а кириллическая «с» неотличима от латинской «c»
при сравнении строк.

Ответы `/query` под правило не попадают: там содержательный текст на языке
вопроса, и он должен быть русским.
"""

from app.services.dashboard_service import DATASET_SOURCE, TARGET_UNITS


def _is_ascii(value: str) -> bool:
    return value.isascii()


def test_units_are_ascii():
    for target, unit in TARGET_UNITS.items():
        assert _is_ascii(unit), f"единицы '{unit}' для {target} содержат не-ASCII"


def test_dataset_source_is_ascii():
    assert _is_ascii(DATASET_SOURCE)


def test_units_avoid_superscripts():
    # надстрочные знаки ломаются при копировании в терминал и CSV
    for unit in TARGET_UNITS.values():
        assert "²" not in unit and "³" not in unit


def test_dashboard_payload_is_ascii(client):
    """Весь JSON дашборда целиком, кроме полей, заполняемых человеком."""
    body = client.get("/dashboard").text
    non_ascii = {ch for ch in body if not ch.isascii()}
    assert not non_ascii, f"в ответе /dashboard не-ASCII символы: {non_ascii}"
