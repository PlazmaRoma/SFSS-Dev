"""Доступ к API: с этой машины свободно, с других адресов по ключу."""

import ipaddress
import re
import secrets

from fastapi import Depends, HTTPException, Request, status

from app.config import Settings, get_settings


def is_loopback(host: str | None) -> bool:
    try:
        address = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    mapped = getattr(address, "ipv4_mapped", None)
    return (mapped or address).is_loopback


def origin_allowed(origin: str, settings: Settings) -> bool:
    return re.match(settings.allowed_origins, origin) is not None


def provided_key(request: Request) -> str | None:
    key = request.headers.get("x-api-key")
    if key:
        return key
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def require_api_key(request: Request, settings: Settings = Depends(get_settings)) -> None:
    """Проверяется на каждом запросе, кроме /docs и /openapi.json.

    Адреса машины недостаточно: страница чужого сайта в браузере тоже ходит с
    127.0.0.1. Для загрузки файла ей не нужен preflight, так что CORS запрос не
    остановит. Поэтому с чужим Origin доверия нет и с этой машины.
    """
    origin = request.headers.get("origin")
    host = request.client.host if request.client else None
    if is_loopback(host) and (origin is None or origin_allowed(origin, settings)):
        return

    key = provided_key(request)
    expected = settings.sfss_api_key
    if key and expected and secrets.compare_digest(key.encode(), expected.encode()):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="API key required: send X-API-Key or Authorization: Bearer",
        headers={"WWW-Authenticate": "Bearer"},
    )
