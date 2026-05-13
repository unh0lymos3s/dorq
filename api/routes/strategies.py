from typing import Literal

import sentry_sdk
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from core.llm.strategy_gen import generate_strategy

router = APIRouter(prefix="/strategies", tags=["strategies"])

Provider = Literal["openai", "anthropic", "groq", "azure", "bedrock", "ollama", "gemini"]


class GenerateRequest(BaseModel):
    paper_id: str
    provider: Provider
    model: str
    api_key: str


@router.post("/generate")
async def generate_strategy_route(request: Request, body: GenerateRequest):
    sentry_sdk.set_tag("paper.id", body.paper_id)
    sentry_sdk.set_tag("llm.provider", body.provider)
    sentry_sdk.set_tag("llm.model", body.model)

    entry = await request.app.state.papers.get(body.paper_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"paper {body.paper_id!r} not found")

    parsed = entry["parsed"]

    try:
        spec = await generate_strategy(parsed, body.provider, body.model, body.api_key)
    except ValueError as exc:
        msg = str(exc)
        status_code = (
            status.HTTP_422_UNPROCESSABLE_ENTITY
            if msg == "llm_invalid_json"
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        detail = "LLM failed to produce valid JSON after retry" if msg == "llm_invalid_json" else msg
        raise HTTPException(status_code, detail) from exc

    strategy_id = body.paper_id
    await request.app.state.strategies.put(strategy_id, spec)

    return spec
