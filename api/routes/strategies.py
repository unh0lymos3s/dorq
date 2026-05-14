import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from core.llm.code_strategy_gen import generate_code_strategy
from core.llm.strategy_gen import generate_strategy

router = APIRouter(prefix="/strategies", tags=["strategies"])
logger = logging.getLogger("dorq." + __name__)

Provider = Literal["openai", "anthropic", "groq", "azure", "bedrock", "ollama", "gemini"]


class GenerateRequest(BaseModel):
    paper_id: str
    provider: Provider
    model: str
    api_key: str


@router.post("/generate")
async def generate_strategy_route(request: Request, body: GenerateRequest):
    logger.info("strategy.generate paper_id=%s provider=%s model=%s",
                body.paper_id, body.provider, body.model)

    entry = await request.app.state.papers.get(body.paper_id)
    if entry is None:
        logger.info("strategy.generate not_found paper_id=%s", body.paper_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"paper {body.paper_id!r} not found")

    parsed = entry["parsed"]

    try:
        spec = await generate_strategy(parsed, body.provider, body.model, body.api_key)
    except ValueError as exc:
        msg = str(exc)
        detail = "LLM failed to produce valid JSON after retry" if msg == "llm_invalid_json" else msg
        logger.info("strategy.generate failed paper_id=%s error=%s", body.paper_id, detail)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail) from exc
    except Exception as exc:
        logger.error("strategy.generate error paper_id=%s", body.paper_id, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "strategy_runtime_error") from exc

    await request.app.state.strategies.put(body.paper_id, spec)
    logger.info("strategy.generate done paper_id=%s assets=%s timeframe=%s",
                body.paper_id, spec.assets, spec.timeframe)
    return spec


@router.post("/generate-code")
async def generate_code_strategy_route(request: Request, body: GenerateRequest):
    logger.info("strategy.generate_code paper_id=%s provider=%s model=%s",
                body.paper_id, body.provider, body.model)

    entry = await request.app.state.papers.get(body.paper_id)
    if entry is None:
        logger.info("strategy.generate_code not_found paper_id=%s", body.paper_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"paper {body.paper_id!r} not found")

    parsed = entry["parsed"]

    try:
        code, config = await generate_code_strategy(parsed, body.provider, body.model, body.api_key)
    except ValueError as exc:
        msg = str(exc)
        detail = "LLM failed to produce valid JSON after retry" if msg == "llm_invalid_json" else msg
        logger.info("strategy.generate_code failed paper_id=%s error=%s", body.paper_id, detail)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail) from exc
    except Exception as exc:
        logger.error("strategy.generate_code error paper_id=%s", body.paper_id, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "strategy_runtime_error") from exc

    strategy_id = body.paper_id + ":code"
    payload = {"strategy_code": code, "portfolio_config": config}
    await request.app.state.strategies.put(strategy_id, payload)
    logger.info("strategy.generate_code done paper_id=%s assets=%s timeframe=%s code_len=%d",
                body.paper_id, config.assets, config.timeframe, len(code))
    return {"strategy_code": code, "portfolio_config": config.model_dump(mode="json")}
