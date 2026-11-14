"""/v1/documents — какие отчёты в корпусе, загрузка новых, страница как PDF."""

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status

from app.dependencies import get_document_service
from app.models.schemas import DocumentInfo, DocumentsResponse
from app.services.document_service import (
    DocumentExistsError,
    DocumentNotFoundError,
    DocumentRejectedError,
    DocumentService,
    DocumentTooLargeError,
)

router = APIRouter(tags=["documents"])


@router.get("/documents", response_model=DocumentsResponse)
def list_documents(
    service: DocumentService = Depends(get_document_service),
) -> DocumentsResponse:
    return DocumentsResponse(documents=service.list())


@router.post("/documents", response_model=DocumentInfo, status_code=status.HTTP_201_CREATED)
def add_document(
    file: UploadFile = File(description="PDF с текстовым слоем"),
    service: DocumentService = Depends(get_document_service),
) -> DocumentInfo:
    """Добавляет PDF в корпус. Отвечает, когда документ уже доступен для поиска."""
    try:
        return service.add(file.filename or "", file.file)
    except DocumentExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Document already exists: {exc}"
        ) from exc
    except DocumentTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)
        ) from exc
    except DocumentRejectedError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get(
    "/documents/{doc_id}/pages/{page}",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}}},
)
def document_page(
    doc_id: str,
    page: int,
    service: DocumentService = Depends(get_document_service),
) -> Response:
    """Одна страница отчёта отдельным PDF, чтобы открыть источник рядом с ответом."""
    try:
        content = service.page_pdf(doc_id, page)
    except DocumentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Not found: {exc}"
        ) from exc
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline"},
    )
