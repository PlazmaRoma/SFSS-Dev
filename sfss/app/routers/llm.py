"""Управлять нейросетью, не открывая её рантайм: загрузка модели и настройки."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.dependencies import get_llm_service
from app.models.schemas import LLMConfigResponse, LLMModelsResponse, LoadModelResponse
from app.services.llm_config import ConfigError, LLMConfigPatch
from app.services.llm_service import LLMService, ModelBusyError, ModelLoadError

router = APIRouter(tags=["llm"])


def _model_answer(llm: LLMService) -> LoadModelResponse:
    loaded, context_length = llm.model_state()
    return LoadModelResponse(
        model=llm.config.model.name, model_loaded=loaded, model_context_length=context_length
    )


@router.post("/llm/load", response_model=LoadModelResponse)
def load_model(llm: LLMService = Depends(get_llm_service)) -> LoadModelResponse:
    """Уже загруженная с нужным контекстом модель не трогается, повтор безопасен."""
    try:
        llm.load_model()
    except ModelLoadError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return _model_answer(llm)


@router.post("/llm/unload", response_model=LoadModelResponse)
def unload_model(llm: LLMService = Depends(get_llm_service)) -> LoadModelResponse:
    """Уже выгруженная модель не ошибка, повтор безопасен."""
    try:
        llm.unload_model()
    except ModelLoadError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return _model_answer(llm)


def _config_answer(llm: LLMService, settings: Settings) -> LLMConfigResponse:
    reachable = llm.ping()
    available = None
    if reachable:
        try:
            # Выгруженная модель тоже есть у рантайма: смотрим список, а не состояние
            available = any(
                entry["id"] in (llm.config.model.name, f"{llm.config.model.name}:latest")
                for entry in llm.models()
            )
        except ModelLoadError:
            pass
    return LLMConfigResponse.model_validate({
        "runtime": {
            **llm.config.runtime.model_dump(),
            "name": llm.runtime.name,
            "controls_context": llm.runtime.controls_context,
            "reachable": reachable,
        },
        "model": {**llm.config.model.model_dump(), "available": available},
        "embedding_model": settings.embedding_model,
    })


@router.get("/llm/config", response_model=LLMConfigResponse)
def read_config(
    llm: LLMService = Depends(get_llm_service),
    settings: Settings = Depends(get_settings),
) -> LLMConfigResponse:
    return _config_answer(llm, settings)


@router.patch("/llm/config", response_model=LLMConfigResponse)
def change_config(
    patch: LLMConfigPatch,
    llm: LLMService = Depends(get_llm_service),
    settings: Settings = Depends(get_settings),
) -> LLMConfigResponse:
    """Только то, что меняется: рантайм и модель настраиваются независимо.

    Рантайм, который сейчас не отвечает, не ошибка: его могут запустить позже.
    """
    try:
        llm.update_config(patch)
    except ConfigError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ModelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _config_answer(llm, settings)


@router.delete("/llm/config", response_model=LLMConfigResponse)
def reset_config(
    llm: LLMService = Depends(get_llm_service),
    settings: Settings = Depends(get_settings),
) -> LLMConfigResponse:
    """Назад к значениям из .env."""
    try:
        llm.reset_config()
    except ModelBusyError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _config_answer(llm, settings)


@router.get("/llm/models", response_model=LLMModelsResponse)
def list_models(llm: LLMService = Depends(get_llm_service)) -> LLMModelsResponse:
    """Что лежит на диске у рантайма. Запрещённые регламентом модели здесь не показываются."""
    try:
        models = llm.models()
    except ModelLoadError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return LLMModelsResponse.model_validate({"runtime": llm.config.runtime.kind, "models": models})
