"""Typed error codes and HTTP exception helper for dorq.

Usage::

    from core.errors import raise_http, ERR_ALPACA_FETCH, ERR_INTERNAL

    raise_http(422, ERR_ALPACA_FETCH, "SPY — no data returned for date range")
"""
from typing import NoReturn

from fastapi import HTTPException

# ---------------------------------------------------------------------------
# Error code constants
# ---------------------------------------------------------------------------

ERR_ALPACA_FETCH = "alpaca_fetch_error"
ERR_ALPACA_NOT_CONFIGURED = "alpaca_not_configured"
ERR_OLLAMA_NOT_CONFIGURED = "ollama_not_configured"
ERR_BACKTEST_RUNTIME = "backtest_runtime_error"
ERR_LLM_INVALID_JSON = "llm_invalid_json"
ERR_DOCLING_PARSE = "docling_parse_error"
ERR_INTERNAL = "internal_error"
ERR_STRATEGY_RUNTIME = "strategy_runtime_error"
ERR_NOT_FOUND = "not_found"
ERR_MISSING_CONTEXT = "missing_context"


def raise_http(status: int, code: str, detail: str) -> NoReturn:
    """Raise an HTTPException with a structured ``{"error": code, "detail": detail}`` body.

    This ensures no raw stack traces leak to clients and that all error
    responses follow the same JSON envelope.
    """
    raise HTTPException(status_code=status, detail={"error": code, "detail": detail})
