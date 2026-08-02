"""POST /chat — Q&A over parsed papers and/or strategy specs.

The route is intentionally thin: it delegates all LLM logic to the existing
core/llm layer and never stores API keys beyond the request lifetime.
"""
import json
import logging

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field

from config import settings
from core.errors import (
    ERR_MISSING_CONTEXT,
    ERR_NOT_FOUND,
    ERR_OLLAMA_NOT_CONFIGURED,
    ERR_PAPER_NOT_READY,
    raise_http,
)
from core.llm.client import build_litellm_kwargs, complete
from core.llm.prompts import (
    CHAT_PAPER_CONTEXT,
    CHAT_STRATEGY_CONTEXT,
    CHAT_SYSTEM_PROMPT,
)

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("dorq." + __name__)


class ChatRequest(BaseModel):
    # Bounded input: a single question, not an unbounded prompt surface.
    question: str = Field(min_length=1, max_length=4_000)
    paper_id: str | None = Field(default=None, max_length=128)
    strategy_id: str | None = Field(default=None, max_length=128)  # a backtest_id in app.state.backtests


class ChatResponse(BaseModel):
    answer: str


@router.post("", response_model=ChatResponse)
async def chat(request: Request, body: ChatRequest) -> ChatResponse:
    if not settings.ollama_configured:
        raise_http(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            ERR_OLLAMA_NOT_CONFIGURED,
            "No model configured — set DORQ_OLLAMA_MODEL to an Ollama model tag",
        )
    if body.paper_id is None and body.strategy_id is None:
        raise_http(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            ERR_MISSING_CONTEXT,
            "must provide paper_id or strategy_id",
        )

    context_parts: list[str] = []

    # --- Resolve paper context ---
    if body.paper_id is not None:
        entry = await request.app.state.papers.get(body.paper_id)
        if entry is None:
            logger.info("chat.paper not_found paper_id=%s", body.paper_id)
            raise_http(
                status.HTTP_404_NOT_FOUND,
                ERR_NOT_FOUND,
                f"paper {body.paper_id!r} not found",
            )
        parsed = entry.get("parsed")
        if parsed is None:
            logger.info("chat.paper not_ready paper_id=%s status=%s",
                        body.paper_id, entry.get("status", "parsing"))
            raise_http(
                status.HTTP_409_CONFLICT,
                ERR_PAPER_NOT_READY,
                "paper is still parsing",
            )
        context_parts.append(
            CHAT_PAPER_CONTEXT.format(paper_markdown=parsed.full_markdown[:12_000])
        )

    # --- Resolve strategy context ---
    if body.strategy_id is not None:
        backtest_result = await request.app.state.backtests.get(body.strategy_id)
        if backtest_result is None:
            logger.info("chat.strategy not_found strategy_id=%s", body.strategy_id)
            raise_http(
                status.HTTP_404_NOT_FOUND,
                ERR_NOT_FOUND,
                f"strategy/backtest {body.strategy_id!r} not found",
            )
        if backtest_result.strategy_spec is not None:
            spec_json = json.dumps(
                backtest_result.strategy_spec.model_dump(mode="json"), indent=2
            )
            context_parts.append(CHAT_STRATEGY_CONTEXT.format(strategy_json=spec_json))

    context = "\n\n".join(context_parts)
    system_content = CHAT_SYSTEM_PROMPT.format(context=context)

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": body.question},
    ]

    # Chat responses are free-form text — never request JSON mode for Q&A.
    kwargs = build_litellm_kwargs(json_mode=False)

    logger.info(
        "chat.request paper_id=%s strategy_id=%s",
        body.paper_id,
        body.strategy_id,
    )

    try:
        answer = await complete(messages, **kwargs)
    except Exception as exc:
        logger.error("chat.llm_error", exc_info=True)
        raise_http(
            status.HTTP_502_BAD_GATEWAY,
            "llm_error",
            "Couldn't reach the local model. Make sure Ollama is running and the model is pulled.",
        )

    logger.info("chat.done answer_len=%d", len(answer))
    return ChatResponse(answer=answer)
