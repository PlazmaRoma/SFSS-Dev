"""Установщики в корне репозитория: то, что ломается незаметно и всплывает только на чужой машине."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_powershell_script_has_bom():
    # Без BOM Windows PowerShell 5 читает файл в ANSI: байты кириллицы становятся
    # кавычками, и скрипт не разбирается вовсе
    assert (ROOT / "install.ps1").read_bytes().startswith(b"\xef\xbb\xbf")


def test_shell_script_has_unix_line_endings():
    assert b"\r\n" not in (ROOT / "install.sh").read_bytes()


def test_installers_pin_the_same_versions():
    sh = (ROOT / "install.sh").read_text(encoding="utf-8")
    ps1 = (ROOT / "install.ps1").read_text(encoding="utf-8-sig")
    for value in ('3.12', '0.12.5', 'ministral-3:3b', 'ministral-3-3b-instruct-2512'):
        assert value in sh and value in ps1, value
