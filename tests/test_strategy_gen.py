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
    spec = await generate_strategy(PAPER, "openai", "gpt-4o", "sk-test")
    assert isinstance(spec, StrategySpec)
    assert spec.title == "Momentum Strategy"
    assert spec.assets == ["SPY"]


async def test_raises_on_llm_error_key(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(
        {"error": "cannot map to a quantifiable strategy"}
    )
    with pytest.raises(ValueError, match="cannot map to a quantifiable strategy"):
        await generate_strategy(PAPER, "openai", "gpt-4o", "sk-test")


async def test_retries_on_invalid_json_then_succeeds(mock_complete):
    valid_content = json.dumps(VALID_SPEC)
    mock_complete.side_effect = [
        _make_response("not valid json{{{{"),
        _make_response(valid_content),
    ]
    spec = await generate_strategy(PAPER, "openai", "gpt-4o", "sk-test")
    assert isinstance(spec, StrategySpec)
    assert mock_complete.call_count == 2


async def test_raises_llm_invalid_json_after_two_failures(mock_complete):
    mock_complete.side_effect = [
        _make_response("not json"),
        _make_response("still not json"),
    ]
    with pytest.raises(ValueError, match="llm_invalid_json"):
        await generate_strategy(PAPER, "openai", "gpt-4o", "sk-test")


async def test_json_mode_set_for_openai(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(VALID_SPEC)
    await generate_strategy(PAPER, "openai", "gpt-4o", "sk-test")
    call_kwargs = mock_complete.call_args.kwargs
    assert call_kwargs.get("response_format") == {"type": "json_object"}


async def test_no_json_mode_for_anthropic(mock_complete):
    mock_complete.return_value.choices[0].message.content = json.dumps(VALID_SPEC)
    await generate_strategy(PAPER, "anthropic", "claude-sonnet-4-6", "sk-ant-test")
    call_kwargs = mock_complete.call_args.kwargs
    assert "response_format" not in call_kwargs


async def test_retry_message_includes_prefix(mock_complete):
    valid_content = json.dumps(VALID_SPEC)
    mock_complete.side_effect = [
        _make_response("bad json"),
        _make_response(valid_content),
    ]
    await generate_strategy(PAPER, "openai", "gpt-4o", "sk-test")
    retry_user_msg = mock_complete.call_args_list[1].kwargs["messages"][1]["content"]
    assert "not valid JSON" in retry_user_msg


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_response(content: str):
    resp = AsyncMock()
    resp.choices[0].message.content = content
    return resp
