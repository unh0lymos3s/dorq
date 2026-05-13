import json

from pydantic import ValidationError

from core.llm._utils import _strip_fences
from core.llm.client import build_litellm_kwargs, complete
from core.llm.code_prompts import CODE_RETRY_PREFIX, CODE_SYSTEM_PROMPT, CODE_USER_PROMPT_TEMPLATE
from core.models.paper import ParsedPaper
from core.models.strategy import PortfolioConfig


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
    return strategy_code, portfolio_config


async def generate_code_strategy(
    parsed_paper: ParsedPaper,
    provider: str,
    model: str,
    api_key: str,
) -> tuple[str, PortfolioConfig]:
    kwargs = build_litellm_kwargs(provider, model, api_key)
    kwargs["max_tokens"] = 4096

    user_content = CODE_USER_PROMPT_TEMPLATE.format(
        abstract=parsed_paper.sections.get("abstract", ""),
        methodology=parsed_paper.sections.get("methodology", ""),
        results=parsed_paper.sections.get("results", ""),
    )
    messages = [
        {"role": "system", "content": CODE_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    last_exc: Exception = ValueError("llm_invalid_json")
    for attempt in range(2):
        content = await complete(messages, **kwargs)
        try:
            return _parse_code_response(content)
        except ValueError:
            raise  # LLM declined — do not retry
        except (json.JSONDecodeError, ValidationError, TypeError, KeyError) as exc:
            last_exc = exc
        messages[1]["content"] = CODE_RETRY_PREFIX + user_content
    raise ValueError("llm_invalid_json") from last_exc
