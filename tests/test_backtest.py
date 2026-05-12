"""
Tests for core/backtest/{engine,metrics}.

The integration test requires live Alpaca paper-trading credentials:
  ALPACA_API_KEY, ALPACA_SECRET_KEY  →  set DORQ_RUN_INTEGRATION=1

Unit tests mock the bars dict and verify signal generation + metric extraction.
"""

import os
from datetime import date
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from core.models.strategy import IndicatorDef, RiskParams, StrategySpec

SKIP_INTEGRATION = not os.getenv("DORQ_RUN_INTEGRATION")

SMA_CROSSOVER_SPEC = StrategySpec(
    title="SMA Crossover Test",
    summary="Buy when 50-day SMA crosses above 200-day SMA.",
    assets=["SPY"],
    timeframe="1D",
    date_range=(date(2015, 1, 1), date(2023, 12, 31)),
    indicators=[
        IndicatorDef(name="SMA", params={"period": 50}),
        IndicatorDef(name="SMA", params={"period": 200}),
    ],
    entry_conditions=["SMA_50 > SMA_200"],
    exit_conditions=["SMA_50 < SMA_200"],
    position_sizing="equal_weight",
    risk_params=RiskParams(stop_loss_pct=None, take_profit_pct=None),
)


def _make_bars(n: int = 500) -> dict[str, pd.DataFrame]:
    idx = pd.date_range("2015-01-01", periods=n, freq="D")
    close = pd.Series(100.0 + np.cumsum(np.random.randn(n) * 0.5), index=idx)
    df = pd.DataFrame({
        "open": close * 0.999,
        "high": close * 1.002,
        "low": close * 0.998,
        "close": close,
        "volume": np.full(n, 1_000_000),
    })
    return {"SPY": df}


async def test_run_backtest_returns_portfolio():
    from core.backtest.engine import run_backtest
    bars = _make_bars()
    portfolio = await run_backtest(SMA_CROSSOVER_SPEC, bars)
    assert portfolio is not None


async def test_extract_metrics_returns_expected_keys():
    from core.backtest.engine import run_backtest
    from core.backtest.metrics import extract_metrics
    bars = _make_bars()
    portfolio = await run_backtest(SMA_CROSSOVER_SPEC, bars)
    metrics = extract_metrics(portfolio)
    for key in ("total_return", "sharpe_ratio", "max_drawdown", "win_rate", "num_trades"):
        assert key in metrics


async def test_extract_metrics_values_are_float_or_none():
    from core.backtest.engine import run_backtest
    from core.backtest.metrics import extract_metrics
    bars = _make_bars()
    portfolio = await run_backtest(SMA_CROSSOVER_SPEC, bars)
    metrics = extract_metrics(portfolio)
    for v in metrics.values():
        assert v is None or isinstance(v, float)


async def test_unsupported_indicator_raises():
    from core.backtest.engine import run_backtest
    bad_spec = SMA_CROSSOVER_SPEC.model_copy(update={
        "indicators": [IndicatorDef(name="UNKNOWN", params={"period": 10})]
    })
    bars = _make_bars()
    with pytest.raises(ValueError, match="unsupported indicator"):
        await run_backtest(bad_spec, bars)


async def test_unparseable_condition_raises():
    from core.backtest.engine import run_backtest
    bad_spec = SMA_CROSSOVER_SPEC.model_copy(update={
        "entry_conditions": ["eval(__import__('os').system('id'))"]
    })
    bars = _make_bars()
    with pytest.raises(ValueError, match="unparseable condition"):
        await run_backtest(bad_spec, bars)


async def test_percent_equity_position_sizing():
    from core.backtest.engine import run_backtest
    spec = SMA_CROSSOVER_SPEC.model_copy(update={"position_sizing": "percent_equity"})
    bars = _make_bars()
    portfolio = await run_backtest(spec, bars)
    assert portfolio is not None


# ---------------------------------------------------------------------------
# Integration — requires live Alpaca credentials + DORQ_RUN_INTEGRATION=1
# ---------------------------------------------------------------------------

@pytest.mark.skipif(SKIP_INTEGRATION, reason="set DORQ_RUN_INTEGRATION=1 to run")
async def test_integration_sma_crossover():
    from core.backtest.data import fetch_bars
    from core.backtest.engine import run_backtest
    from core.backtest.metrics import extract_metrics, render_charts

    api_key = os.environ["ALPACA_API_KEY"]
    secret_key = os.environ["ALPACA_SECRET_KEY"]

    bars = await fetch_bars(
        assets=["SPY"],
        start=date(2015, 1, 1),
        end=date(2023, 12, 31),
        timeframe="1D",
        api_key=api_key,
        secret_key=secret_key,
    )
    assert "SPY" in bars
    assert not bars["SPY"].empty

    portfolio = await run_backtest(SMA_CROSSOVER_SPEC, bars)
    metrics = extract_metrics(portfolio)
    assert isinstance(metrics["total_return"], float)

    charts = render_charts(portfolio)
    assert len(charts) >= 1
    assert len(charts[0]) > 0
