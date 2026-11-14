from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_powershell_script_has_bom():
    assert (ROOT / "install.ps1").read_bytes().startswith(b"\xef\xbb\xbf")


def test_shell_script_has_unix_line_endings():
    assert b"\r\n" not in (ROOT / "install.sh").read_bytes()


def test_installers_pin_the_same_versions():
    sh = (ROOT / "install.sh").read_text(encoding="utf-8")
    ps1 = (ROOT / "install.ps1").read_text(encoding="utf-8-sig")
    for value in ('3.12', '0.12.5', 'ministral-3:3b', 'ministral-3-3b-instruct-2512'):
        assert value in sh and value in ps1, value


def test_powershell_run_has_no_named_parameters():
    ps1 = (ROOT / "install.ps1").read_text(encoding="utf-8-sig")
    assert "function Run {" in ps1
    assert "function Run(" not in ps1
