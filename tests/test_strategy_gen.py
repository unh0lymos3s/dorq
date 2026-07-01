"""Tests for core/llm/strategy_gen.py — all mocked, no real LLM calls."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from core.llm.strategy_gen import generate_strategy
from core.models.paper import ParsedPaper
from core.models.strategy import StrategySpec

PAPER = ParsedPaper(
    paper_id="test-123",
    full_markdown="# Test Paper",
    sections={
        "abstract": "We study momentum.",
        "methodology": "Sort stocks by 12-1 return.",
        "results": "Top decile earns 1%/month.",
        "introduction": "",
        "findings": "",
        "conclusion": "",
    },
)

VALID_SPEC = {
    "title": "Momentum Strategy",
    "summary": "Buy top decile momentum stocks monthly.",
    "assets": ["SPY"],
    "timeframe": "1M",
    "date_range": ["2010-01-01", "2023-12-31"],
    "indicators": [{"name": "SMA", "params": {"period": 20}}],
    "entry_conditions": ["SMA_20 > close"],
    "exit_conditions": ["SMA_20 < close"],
    "position_sizing": "equal_weight",
    "risk_params": {"stop_loss_pct": None, "take_profit_pct": None},
}


@pytest.fixture
def mock_complete():
    with patch("core.llm.client.litellm") as mock_litellm:
        mock_response = AsyncMock()
        mock_litellm.acompletion = mock_response
        yield mock_response


async def test_returns_strategy_spec_on_valid_response(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(VALID_SPEC)
    spec = await generate_strategy(PAPER)
    assert isinstance(spec, StrategySpec)
    assert spec.title == "Momentum Strategy"
    assert spec.assets == ["SPY"]


async def test_raises_on_llm_error_key(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(
        {"error": "cannot map to a quantifiable strategy"}
    )
    with pytest.raises(ValueError, match="cannot map to a quantifiable strategy"):
        await generate_strategy(PAPER)


async def test_retries_on_invalid_json_then_succeeds(mock_complete):
    mock_complete.side_effect = [
        _make_response("not valid json{{{{"),
        _make_response(json.dumps(VALID_SPEC)),
    ]
    spec = await generate_strategy(PAPER)
    assert isinstance(spec, StrategySpec)
    assert mock_complete.call_count == 2


async def test_raises_llm_invalid_json_after_two_failures(mock_complete):
    mock_complete.side_effect = [
        _make_response("not json"),
        _make_response("still not json"),
    ]
    with pytest.raises(ValueError, match="llm_invalid_json"):
        await generate_strategy(PAPER)


async def test_targets_local_ollama(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(VALID_SPEC)
    await generate_strategy(PAPER)
    call_kwargs = mock_complete.call_args.kwargs
    assert str(call_kwargs.get("model")).startswith("ollama_chat/")
    assert call_kwargs.get("api_base")


async def test_json_format_requested(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(VALID_SPEC)
    await generate_strategy(PAPER)
    call_kwargs = mock_complete.call_args.kwargs
    assert call_kwargs.get("format") == "json"


async def test_retry_message_includes_prefix(mock_complete):
    mock_complete.side_effect = [
        _make_response("bad json"),
        _make_response(json.dumps(VALID_SPEC)),
    ]
    await generate_strategy(PAPER)
    retry_user_msg = mock_complete.call_args_list[1].kwargs["messages"][1]["content"]
    assert "not valid JSON" in retry_user_msg


async def test_strips_markdown_fences(mock_complete):
    fenced = f"```json\n{json.dumps(VALID_SPEC)}\n```"
    mock_complete.return_value.choices[0].message.content = fenced
    spec = await generate_strategy(PAPER)
    assert isinstance(spec, StrategySpec)


async def test_none_content_retries_then_raises(mock_complete):
    mock_complete.side_effect = [
        _make_response(None),
        _make_response(None),
    ]
    with pytest.raises(ValueError, match="llm_invalid_json"):
        await generate_strategy(PAPER)


async def test_list_json_raises_llm_invalid_json(mock_complete):
    mock_complete.side_effect = [
        _make_response(json.dumps([VALID_SPEC])),  # list, not dict
        _make_response(json.dumps([VALID_SPEC])),
    ]
    with pytest.raises(ValueError, match="llm_invalid_json"):
        await generate_strategy(PAPER)


async def test_timeout_and_num_retries_set(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(VALID_SPEC)
    await generate_strategy(PAPER)
    from config import settings
    call_kwargs = mock_complete.call_args.kwargs
    assert call_kwargs.get("timeout") == settings.llm_timeout
    assert call_kwargs.get("num_retries") == 0
    assert call_kwargs.get("max_tokens") == 2048


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_response(content):
    resp = AsyncMock()
    resp.choices[0].message.content = content or ""
    return resp
