import logging

from fastapi import APIRouter, Request, status
from pydantic import BaseModel

from config import settings
from core.errors import (
    ERR_DOCLING_PARSE,
    ERR_LLM_INVALID_JSON,
    ERR_OLLAMA_NOT_CONFIGURED,
    ERR_STRATEGY_RUNTIME,
    raise_http,
)
from core.llm.code_strategy_gen import generate_code_strategy
from core.llm.strategy_gen import generate_strategy

router = APIRouter(prefix="/strategies", tags=["strategies"])
logger = logging.getLogger("dorq." + __name__)


def _require_model() -> None:
    if not settings.ollama_configured:
        raise_http(status.HTTP_503_SERVICE_UNAVAILABLE, ERR_OLLAMA_NOT_CONFIGURED,
                   "No model configured — set DORQ_OLLAMA_MODEL to an Ollama model tag")


class GenerateRequest(BaseModel):
    paper_id: str


@router.post("/generate")
async def generate_strategy_route(request: Request, body: GenerateRequest):
    _require_model()
    logger.info("strategy.generate paper_id=%s", body.paper_id)

    entry = await request.app.state.papers.get(body.paper_id)
    if entry is None:
        logger.info("strategy.generate not_found paper_id=%s", body.paper_id)
        raise_http(status.HTTP_404_NOT_FOUND, "not_found", f"paper {body.paper_id!r} not found")

    parsed = entry["parsed"]

    try:
        spec = await generate_strategy(parsed)
    except ValueError as exc:
        msg = str(exc)
        if msg == "llm_invalid_json":
            logger.info("strategy.generate failed paper_id=%s error=%s", body.paper_id, msg)
            raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_LLM_INVALID_JSON,
                       "LLM returned unparseable JSON after retry")
        elif msg.startswith("docling_parse_error"):
            detail = msg.split(": ", 1)[1] if ": " in msg else msg
            logger.info("strategy.generate failed paper_id=%s error=%s", body.paper_id, msg)
            raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_DOCLING_PARSE, detail)
        else:
            logger.info("strategy.generate failed paper_id=%s error=%s", body.paper_id, msg)
            raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_STRATEGY_RUNTIME, msg)
    except Exception as exc:
        logger.error("strategy.generate error paper_id=%s", body.paper_id, exc_info=True)
        raise_http(status.HTTP_500_INTERNAL_SERVER_ERROR, ERR_STRATEGY_RUNTIME, "strategy_runtime_error")

    await request.app.state.strategies.put(body.paper_id, spec)
    memory = getattr(request.app.state, "memory", None)
    if memory is not None:
        await memory.add_strategy(body.paper_id, body.paper_id, spec=spec)
    logger.info("strategy.generate done paper_id=%s assets=%s timeframe=%s",
                body.paper_id, spec.assets, spec.timeframe)
    return spec


@router.post("/generate-code")
async def generate_code_strategy_route(request: Request, body: GenerateRequest):
    _require_model()
    logger.info("strategy.generate_code paper_id=%s", body.paper_id)

    entry = await request.app.state.papers.get(body.paper_id)
    if entry is None:
        logger.info("strategy.generate_code not_found paper_id=%s", body.paper_id)
        raise_http(status.HTTP_404_NOT_FOUND, "not_found", f"paper {body.paper_id!r} not found")

    parsed = entry["parsed"]

    try:
        code, config = await generate_code_strategy(parsed)
    except ValueError as exc:
        msg = str(exc)
        if msg == "llm_invalid_json":
            logger.info("strategy.generate_code failed paper_id=%s error=%s", body.paper_id, msg)
            raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_LLM_INVALID_JSON,
                       "LLM returned unparseable JSON after retry")
        elif msg.startswith("docling_parse_error"):
            detail = msg.split(": ", 1)[1] if ": " in msg else msg
            logger.info("strategy.generate_code failed paper_id=%s error=%s", body.paper_id, msg)
            raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_DOCLING_PARSE, detail)
        else:
            logger.info("strategy.generate_code failed paper_id=%s error=%s", body.paper_id, msg)
            raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_STRATEGY_RUNTIME, msg)
    except Exception as exc:
        logger.error("strategy.generate_code error paper_id=%s", body.paper_id, exc_info=True)
        raise_http(status.HTTP_500_INTERNAL_SERVER_ERROR, ERR_STRATEGY_RUNTIME, "strategy_runtime_error")

    strategy_id = body.paper_id + ":code"
    payload = {"strategy_code": code, "portfolio_config": config}
    await request.app.state.strategies.put(strategy_id, payload)
    memory = getattr(request.app.state, "memory", None)
    if memory is not None:
        await memory.add_strategy(
            strategy_id, body.paper_id,
            strategy_code=code, portfolio_config=config.model_dump(mode="json"),
        )
    logger.info("strategy.generate_code done paper_id=%s assets=%s timeframe=%s code_len=%d",
                body.paper_id, config.assets, config.timeframe, len(code))
    return {"strategy_code": code, "portfolio_config": config.model_dump(mode="json")}
