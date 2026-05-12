from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from core.llm.strategy_gen import generate_strategy

router = APIRouter(prefix="/strategies", tags=["strategies"])


class GenerateRequest(BaseModel):
    paper_id: str
    provider: str
    model: str
    api_key: str


@router.post("/generate")
async def generate_strategy_route(request: Request, body: GenerateRequest):
    entry = await request.app.state.papers.get(body.paper_id)
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"paper {body.paper_id!r} not found")

    parsed = entry["parsed"]

    try:
        spec = await generate_strategy(parsed, body.provider, body.model, body.api_key)
    except ValueError as exc:
        msg = str(exc)
        if msg == "llm_invalid_json":
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "LLM failed to produce valid JSON after retry") from exc
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, msg) from exc

    strategy_id = body.paper_id
    await request.app.state.strategies.put(strategy_id, spec)

    return spec
