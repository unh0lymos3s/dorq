import litellm

from core.llm.prompts import JSON_MODE_PROVIDERS


def build_litellm_kwargs(provider: str, model: str, api_key: str) -> dict:
    kwargs: dict = {
        "model": f"{provider}/{model}",
        "api_key": api_key,
    }
    if provider in JSON_MODE_PROVIDERS:
        kwargs["response_format"] = {"type": "json_object"}
    return kwargs


async def complete(messages: list[dict], **kwargs) -> str:
    response = await litellm.acompletion(messages=messages, **kwargs)
    return response.choices[0].message.content
