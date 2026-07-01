import json
import logging

from pydantic import ValidationError

from core.llm.client import build_litellm_kwargs, complete
from core.llm.prompts import RETRY_PREFIX, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from core.models.paper import ParsedPaper
from core.models.strategy import StrategySpec


from core.llm._utils import _strip_fences  # noqa: F401

logger = logging.getLogger("dorq.llm.strategy_gen")


def _parse_response(content: str) -> StrategySpec:
    data = json.loads(_strip_fences(content))
    if not isinstance(data, dict):
        raise TypeError("LLM returned non-object JSON")
    if "error" in data:
        raise ValueError(data["error"])
    return StrategySpec.model_validate(data)


async def generate_strategy(parsed_paper: ParsedPaper) -> StrategySpec:
    kwargs = build_litellm_kwargs()

    user_content = USER_PROMPT_TEMPLATE.format(
        abstract=parsed_paper.sections.get("abstract", ""),
        methodology=parsed_paper.sections.get("methodology", ""),
        results=parsed_paper.sections.get("results", ""),
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    for attempt in range(2):
        content = await complete(messages, **kwargs)
        try:
            return _parse_response(content)
        except (json.JSONDecodeError, ValidationError, TypeError) as exc:
            logger.warning(
                "strategy.parse_failed attempt=%d error=%s response_preview=%r",
                attempt, exc, content[:500],
            )
            if attempt == 1:
                raise ValueError("llm_invalid_json")
            messages[1]["content"] = RETRY_PREFIX + user_content
