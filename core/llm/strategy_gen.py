import json

from pydantic import ValidationError

from core.llm.client import build_litellm_kwargs, complete
from core.llm.prompts import RETRY_PREFIX, SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from core.models.paper import ParsedPaper
from core.models.strategy import StrategySpec


def _build_messages(parsed_paper: ParsedPaper, retry: bool = False) -> list[dict]:
    user_content = USER_PROMPT_TEMPLATE.format(
        abstract=parsed_paper.sections.get("abstract", ""),
        methodology=parsed_paper.sections.get("methodology", ""),
        results=parsed_paper.sections.get("results", ""),
    )
    if retry:
        user_content = RETRY_PREFIX + user_content
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]


def _parse_response(content: str) -> StrategySpec:
    data = json.loads(content)
    if "error" in data:
        raise ValueError(data["error"])
    return StrategySpec(**data)


async def generate_strategy(
    parsed_paper: ParsedPaper,
    provider: str,
    model: str,
    api_key: str,
) -> StrategySpec:
    kwargs = build_litellm_kwargs(provider, model, api_key)

    for attempt, retry in enumerate([False, True]):
        messages = _build_messages(parsed_paper, retry=retry)
        content = await complete(messages, **kwargs)
        try:
            return _parse_response(content)
        except (json.JSONDecodeError, ValidationError, KeyError):
            if attempt == 1:
                raise ValueError("llm_invalid_json")
            # fall through to retry

    raise ValueError("llm_invalid_json")  # unreachable, satisfies type checker
