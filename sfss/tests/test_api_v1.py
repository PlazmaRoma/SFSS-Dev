"""Внешний API: /v1, ключ доступа, пакетный расчёт, документы, предупреждения."""

import io

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader, PdfWriter

from app.config import Settings, get_settings
from app.dependencies import get_document_service
from app.main import app
from app.routers.predict import parse_csv
from app.security import is_loopback
from app.services.document_service import DocumentService, safe_filename
from app.services.ml_service import MLService

FEATURES = ["oxygen_level", "n2", "co2", "he"]


def pdf_bytes(pages: int = 2) -> bytes:
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


# --- Пути ---------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/v1/health", "/health"])
def test_old_paths_keep_working_next_to_v1(client, path):
    assert client.get(path).status_code == 200


def test_old_paths_are_hidden_from_the_schema(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert "/v1/predict" in paths
    assert "/predict" not in paths


# --- Площадка -----------------------------------------------------------------


def test_playground_is_served_and_asks_the_same_origin(client):
    response = client.get("/playground")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    # Порт демона может быть любым, поэтому адрес в сборке не должен быть зашит
    assert "localhost:8000" not in response.text
    assert "Playground" in response.text


def test_playground_is_guarded(with_key):
    assert TestClient(app, client=("203.0.113.7", 50000)).get("/playground").status_code == 401


# --- Ключ доступа -------------------------------------------------------------


@pytest.fixture
def with_key():
    app.dependency_overrides[get_settings] = lambda: Settings(sfss_api_key="secret")
    yield
    app.dependency_overrides.pop(get_settings)


def remote(_: TestClient) -> TestClient:
    return TestClient(app, client=("203.0.113.7", 50000))


def test_loopback_needs_no_key(client, with_key):
    assert client.get("/v1/health").status_code == 200


def test_remote_address_needs_a_key(client, with_key):
    other = remote(client)
    assert other.get("/v1/health").status_code == 401
    assert other.get("/v1/health", headers={"X-API-Key": "wrong"}).status_code == 401
    assert other.get("/v1/health", headers={"X-API-Key": "secret"}).status_code == 200
    assert other.get("/v1/health", headers={"Authorization": "Bearer secret"}).status_code == 200


def test_remote_is_refused_when_no_key_is_configured(client):
    app.dependency_overrides[get_settings] = lambda: Settings(sfss_api_key=None)
    try:
        assert remote(client).get("/v1/health", headers={"X-API-Key": "any"}).status_code == 401
    finally:
        app.dependency_overrides.pop(get_settings)


def test_old_paths_are_guarded_too(client, with_key):
    assert remote(client).get("/health").status_code == 401


def test_foreign_site_in_browser_is_not_trusted_on_loopback(client, with_key):
    # Страница чужого сайта тоже ходит с 127.0.0.1
    assert client.get("/v1/health", headers={"Origin": "https://evil.example"}).status_code == 401
    headers = {"Origin": "https://evil.example", "X-API-Key": "secret"}
    assert client.get("/v1/health", headers=headers).status_code == 200


@pytest.mark.parametrize(
    "origin",
    ["http://localhost:5173", "http://127.0.0.1:3000", "tauri://localhost", "http://tauri.localhost", "null"],
)
def test_own_pages_are_trusted(client, origin):
    assert client.get("/v1/health", headers={"Origin": origin}).status_code == 200


def test_lookalike_origin_is_not_trusted(client):
    response = client.get("/v1/health", headers={"Origin": "http://localhost.evil.example"})
    assert response.status_code == 401


def test_cors_answers_only_own_origins(client):
    def preflight(origin):
        return client.options(
            "/v1/predict",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
        ).headers.get("access-control-allow-origin")

    assert preflight("http://localhost:5173") == "http://localhost:5173"
    assert preflight("https://evil.example") is None


@pytest.mark.parametrize(
    "host, expected",
    [("127.0.0.1", True), ("::1", True), ("::ffff:127.0.0.1", True), ("10.0.0.1", False), (None, False), ("testclient", False)],
)
def test_is_loopback(host, expected):
    assert is_loopback(host) is expected


# --- Пакетный расчёт: HTTP ----------------------------------------------------


def test_batch_json(client):
    response = client.post("/v1/predict/batch", json={"rows": [{"oxygen_level": 0.3}, {}]})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [row["row"] for row in body["rows"]] == [1, 2]


def test_batch_csv(client):
    response = client.post(
        "/v1/predict/batch",
        content="oxygen_level,n2\n0.3,0.7\n0.25,0.75\n",
        headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 2


@pytest.mark.parametrize(
    "content, content_type",
    [
        ("{not json", "application/json"),
        ('{"rows": 5}', "application/json"),
        ('[{"oxygen_level": 0.3}]', "application/json"),
        ("<xml/>", "application/xml"),
        (b"\xff\xfe\x00", "text/csv"),
    ],
)
def test_batch_bad_body_is_422(client, content, content_type):
    response = client.post(
        "/v1/predict/batch", content=content, headers={"Content-Type": content_type}
    )
    assert response.status_code == 422


def test_batch_row_limit(client):
    app.dependency_overrides[get_settings] = lambda: Settings(max_batch_rows=1)
    try:
        response = client.post("/v1/predict/batch", json={"rows": [{}, {}]})
    finally:
        app.dependency_overrides.pop(get_settings)
    assert response.status_code == 413


def test_csv_empty_cell_means_not_set():
    assert parse_csv(b"oxygen_level,he\n0.3,\n") == [{"oxygen_level": "0.3"}]


def test_csv_bom_and_spaces_are_tolerated():
    assert parse_csv(b"\xef\xbb\xbf oxygen_level , he\n 0.3 , 0.1 \n") == [
        {"oxygen_level": "0.3", "he": "0.1"}
    ]


# --- Пакетный расчёт и предупреждения: сервис ---------------------------------


class ConstantModel:
    def predict(self, x):
        # Модель вызывается один раз на весь пакет
        ConstantModel.calls += 1
        return [0.5] * len(x)

    calls = 0


@pytest.fixture
def ml(tmp_path) -> MLService:
    pd.DataFrame(
        {"oxygen_level": [0.12, 0.34], "n2": [0.09, 0.88], "co2": [0, 0.7], "he": [0, 0.45]}
    ).to_csv(tmp_path / "flex.csv", index=False)
    service = MLService(Settings(processed_dir=tmp_path, models_dir=tmp_path))
    service._bundle = {
        "features": FEATURES,
        "model": ConstantModel(),
        "task": "regression",
        "target": "burn_rate_mm2s",
        "target_range": (0.0, 1.0),
    }
    return service


def test_bad_rows_do_not_stop_good_ones(ml):
    ConstantModel.calls = 0
    result = ml.predict_batch([
        {"oxygen_level": 0.21, "n2": 0.79},
        {"oxigen_level": 0.3},
        {"oxygen_level": "abc"},
        {"oxygen_level": "nan"},
        {"oxygen_level": "0.25", "n2": "0.75"},
    ])
    assert result.total == 5
    assert result.failed == 3
    assert result.rows[0].predicted_value == 0.5
    assert "oxigen_level" in result.rows[1].error
    assert "not a number" in result.rows[2].error
    assert "finite" in result.rows[3].error
    assert result.rows[4].error is None
    assert ConstantModel.calls == 1


def test_batch_of_only_bad_rows_does_not_call_the_model(ml):
    ConstantModel.calls = 0
    result = ml.predict_batch([{"nope": 1}])
    assert result.failed == 1
    assert ConstantModel.calls == 0


def test_warning_outside_training_range(ml):
    warnings = ml.warnings_for({"oxygen_level": 0.45, "n2": 0.55, "co2": 0.0, "he": 0.0})
    assert warnings == ["oxygen_level=0.45 is outside the training range 0.12..0.34"]


def test_warning_gases_do_not_sum_to_one(ml):
    # Именно это получается из {"oxygen_level": 0.30} с воздушным азотом
    warnings = ml.warnings_for({"oxygen_level": 0.30, "n2": 0.79, "co2": 0.0, "he": 0.0})
    assert warnings == ["gas fractions sum to 1.090, not 1"]


def test_no_warnings_for_normal_air(ml):
    assert ml.warnings_for({"oxygen_level": 0.21, "n2": 0.79, "co2": 0.0, "he": 0.0}) == []


def test_warnings_are_ascii(ml):
    # ARCHITECTURE § 7.9: что уходит в API как данные, то в ASCII
    for warning in ml.warnings_for({"oxygen_level": 0.9, "n2": 0.9, "co2": 0.0, "he": 0.0}):
        assert warning.isascii()


def test_no_dataset_means_no_range_warnings(tmp_path):
    service = MLService(Settings(processed_dir=tmp_path / "missing"))
    service._bundle = {"features": FEATURES}
    assert service.warnings_for({"oxygen_level": 0.9}) == []


# --- Документы ----------------------------------------------------------------


class FakeCollection:
    def get(self, include=None):
        return {"metadatas": [{"doc_id": "NTRS-1-Long-Title"}, {"doc_id": "NTRS-1-Long-Title"}, None]}


class FakeRag:
    collection = FakeCollection()


class FakeIngest:
    chunks = 5
    error: Exception | None = None

    def ingest_pdf(self, path):
        if FakeIngest.error:
            raise FakeIngest.error
        return FakeIngest.chunks


@pytest.fixture
def raw_dir(tmp_path):
    FakeIngest.chunks = 5
    FakeIngest.error = None
    service = DocumentService(FakeRag(), FakeIngest(), Settings(raw_dir=tmp_path, max_upload_mb=1))
    app.dependency_overrides[get_document_service] = lambda: service
    yield tmp_path
    app.dependency_overrides.pop(get_document_service)


def upload(client, name="report.pdf", content=None):
    data = pdf_bytes() if content is None else content
    return client.post("/v1/documents", files={"file": (name, data, "application/pdf")})


def test_upload_and_list(client, raw_dir):
    response = upload(client, "My Report (2024).pdf")
    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "My_Report_2024.pdf"
    assert body["chunks"] == 5
    assert (raw_dir / "My_Report_2024.pdf").exists()

    listed = client.get("/v1/documents").json()["documents"]
    assert [doc["doc_id"] for doc in listed] == ["My_Report_2024"]


def test_upload_same_name_is_conflict_and_keeps_the_file(client, raw_dir):
    assert upload(client).status_code == 201
    before = (raw_dir / "report.pdf").read_bytes()
    assert upload(client, content=pdf_bytes(pages=5)).status_code == 409
    assert (raw_dir / "report.pdf").read_bytes() == before


def test_upload_not_a_pdf(client, raw_dir):
    assert upload(client, "x.pdf", b"MZ not a pdf").status_code == 422
    assert list(raw_dir.iterdir()) == []


def test_upload_too_large(client, raw_dir):
    big = b"%PDF-" + b"0" * (1024 * 1024)
    assert upload(client, "big.pdf", big).status_code == 413
    assert list(raw_dir.iterdir()) == []


def test_upload_scan_without_text_is_rejected_and_removed(client, raw_dir):
    FakeIngest.chunks = 0
    response = upload(client)
    assert response.status_code == 422
    assert "text layer" in response.json()["detail"]
    assert list(raw_dir.iterdir()) == []


def test_upload_ingest_failure_leaves_no_file(raw_dir):
    FakeIngest.error = RuntimeError("chroma down")
    service = app.dependency_overrides[get_document_service]()
    with pytest.raises(RuntimeError):
        service.add("report.pdf", io.BytesIO(pdf_bytes()))
    assert list(raw_dir.iterdir()) == []


@pytest.mark.parametrize(
    "name, expected",
    [
        ("../../etc/passwd.pdf", "passwd.pdf"),
        ("..\\..\\evil.pdf", "evil.pdf"),
        ("report.PDF", "report.pdf"),
        (".hidden.pdf", "hidden.pdf"),
        ("report.exe", "report.pdf"),
    ],
)
def test_safe_filename(name, expected):
    assert safe_filename(name, b"x") == expected


def test_safe_filename_cyrillic_becomes_hash():
    name = safe_filename("отчёт.pdf", b"x")
    assert name.startswith("upload-") and name.isascii()


def test_page_is_a_single_page_pdf(client, raw_dir):
    (raw_dir / "NTRS-1-Long-Title.pdf").write_bytes(pdf_bytes(pages=3))
    response = client.get("/v1/documents/NTRS-1-Long-Title/pages/2")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(PdfReader(io.BytesIO(response.content)).pages) == 1


def test_page_by_short_id_from_citation(client, raw_dir):
    (raw_dir / "NTRS-1-Long-Title.pdf").write_bytes(pdf_bytes())
    assert client.get("/v1/documents/NTRS-1/pages/1").status_code == 200


def test_ambiguous_short_id_is_not_guessed(client, raw_dir):
    (raw_dir / "NTRS-1-A.pdf").write_bytes(pdf_bytes())
    (raw_dir / "NTRS-1-B.pdf").write_bytes(pdf_bytes())
    assert client.get("/v1/documents/NTRS-1/pages/1").status_code == 404


@pytest.mark.parametrize("page", [0, 3, -1])
def test_page_out_of_range(client, raw_dir, page):
    (raw_dir / "doc.pdf").write_bytes(pdf_bytes(pages=2))
    assert client.get(f"/v1/documents/doc/pages/{page}").status_code == 404


def test_doc_id_cannot_leave_the_directory(client, raw_dir):
    outside = raw_dir.parent / "secret.pdf"
    outside.write_bytes(pdf_bytes())
    for doc_id in ("..%2Fsecret", "%2E%2E%2Fsecret", "secret"):
        assert client.get(f"/v1/documents/{doc_id}/pages/1").status_code == 404

