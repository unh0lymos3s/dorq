import json
import logging

from pydantic import ValidationError

from core.backtest.validator import validate_strategy_code
from core.llm._utils import _strip_fences
from core.llm.client import build_litellm_kwargs, complete
from core.llm.code_prompts import CODE_RETRY_PREFIX, CODE_SYSTEM_PROMPT, CODE_USER_PROMPT_TEMPLATE
from core.models.paper import ParsedPaper
from core.models.strategy import PortfolioConfig

logger = logging.getLogger("dorq.llm.code_strategy_gen")


def _parse_code_response(content: str) -> tuple[str, PortfolioConfig]:
    data = json.loads(_strip_fences(content))
    if not isinstance(data, dict):
        raise TypeError("LLM returned non-object JSON")
    if "error" in data:
        # LLM explicitly declined — propagate as ValueError, do not retry
        raise ValueError(data["error"])
    strategy_code = data.get("strategy_code")
    if not isinstance(strategy_code, str) or not strategy_code.strip():
        raise TypeError("missing or empty strategy_code field")
    pc = data.get("portfolio_config")
    if pc is None:
        raise TypeError("missing portfolio_config field")
    portfolio_config = PortfolioConfig.model_validate(pc)
    # Run the AST sandbox allowlist at generation time so forbidden constructs
    # (imports, dunders, IO attributes) trigger a retry with feedback instead
    # of surfacing later when the user runs the backtest.
    try:
        validate_strategy_code(strategy_code)
    except ValueError as exc:
        raise TypeError(f"strategy_code rejected by sandbox validator: {exc}") from exc
    return strategy_code, portfolio_config


async def generate_code_strategy(parsed_paper: ParsedPaper) -> tuple[str, PortfolioConfig]:
    kwargs = build_litellm_kwargs()
    kwargs["max_tokens"] = 4096

    # Build user content once; sections.get with the same default is fine.
    sections = parsed_paper.sections
    user_content = CODE_USER_PROMPT_TEMPLATE.format(
        abstract=sections.get("abstract", ""),
        methodology=sections.get("methodology", ""),
        results=sections.get("results", ""),
    )
    user_msg = {"role": "user", "content": user_content}
    messages = [
        {"role": "system", "content": CODE_SYSTEM_PROMPT},
        user_msg,
    ]

    last_exc: Exception | None = None
    for attempt in range(2):
        content = await complete(messages, **kwargs)
        try:
            return _parse_code_response(content)
        # JSONDecodeError subclasses ValueError, so the retryable clause must
        # come first — a bare `except ValueError` would swallow it and skip
        # the retry.
        except (json.JSONDecodeError, ValidationError, TypeError, KeyError) as exc:
            last_exc = exc
            logger.warning(
                "code_strategy.parse_failed attempt=%d error=%s response_preview=%r",
                attempt, exc, content[:500],
            )
            if attempt == 0:
                # Swap content in-place for the retry; avoids rebuilding the list.
                user_msg["content"] = (
                    CODE_RETRY_PREFIX
                    + f"Problem with your previous output: {exc}\n\n"
                    + user_content
                )
        except ValueError:
            raise  # LLM explicitly declined — do not retry
    raise ValueError("llm_invalid_json") from last_exc
