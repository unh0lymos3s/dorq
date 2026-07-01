import logging
import time

import litellm

from config import settings

logger = logging.getLogger("dorq.llm")


def build_litellm_kwargs(json_mode: bool = True) -> dict[str, object]:
    """Build kwargs for a litellm call against the host's local Ollama instance.

    Provider, model, and host all come from server settings — nothing is
    accepted from the client. ``json_mode`` requests Ollama's structured JSON
    output (used for strategy extraction; disabled for free-form Q&A chat).
    """
    kwargs: dict[str, object] = {
        "model": f"ollama_chat/{settings.ollama_model}",
        "api_base": settings.ollama_base_url,
        "timeout": settings.llm_timeout,
        "num_retries": 0,  # we manage retries in strategy_gen; don't double-retry
        "max_tokens": 2048,
    }
    if json_mode:
        kwargs["format"] = "json"
    return kwargs


async def complete(messages: list[dict], **kwargs) -> str:
    """Call the model and return its text, logging timing and any failure.

    Failures (Ollama unreachable, not signed in for a cloud model, timeouts)
    are logged with a full traceback here, then re-raised for the route to map
    to an HTTP status. Set ``DORQ_LOG_LEVEL=debug`` to also see request/response
    previews.
    """
    model = kwargs.get("model")
    logger.info("llm.request model=%s api_base=%s timeout=%ss",
                model, kwargs.get("api_base"), kwargs.get("timeout"))
    logger.debug("llm.request.messages model=%s payload=%r", model, messages)

    t0 = time.perf_counter()
    try:
        response = await litellm.acompletion(messages=messages, **kwargs)
    except Exception as exc:
        elapsed = int((time.perf_counter() - t0) * 1000)
        logger.error("llm.request_failed model=%s elapsed_ms=%d error=%s",
                     model, elapsed, exc, exc_info=True)
        raise

    elapsed = int((time.perf_counter() - t0) * 1000)
    content = response.choices[0].message.content or ""
    logger.info("llm.response model=%s elapsed_ms=%d chars=%d", model, elapsed, len(content))
    logger.debug("llm.response.body model=%s content=%r", model, content[:2000])
    return content
