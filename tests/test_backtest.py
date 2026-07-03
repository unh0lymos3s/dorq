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
    rng = np.random.default_rng(42)
    idx = pd.date_range("2015-01-01", periods=n, freq="D")
    close = pd.Series(100.0 + np.cumsum(rng.standard_normal(n) * 0.5), index=idx)
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
    for key in ("total_return", "sharpe_ratio", "max_drawdown", "win_rate", "num_trades",
                "calmar_ratio", "volatility"):
        assert key in metrics


async def test_extract_metrics_values_are_correct_types():
    from core.backtest.engine import run_backtest
    from core.backtest.metrics import extract_metrics
    bars = _make_bars()
    portfolio = await run_backtest(SMA_CROSSOVER_SPEC, bars)
    metrics = extract_metrics(portfolio)
    for key, v in metrics.items():
        if v is None:
            continue
        if key == "num_trades":
            assert isinstance(v, int), f"{key} should be int, got {type(v)}"
        else:
            assert isinstance(v, float), f"{key} should be float, got {type(v)}"


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


async def test_new_indicators_compute_and_backtest():
    from core.backtest.engine import run_backtest
    spec = SMA_CROSSOVER_SPEC.model_copy(update={
        "indicators": [
            IndicatorDef(name="EMA", params={"period": 20}),
            IndicatorDef(name="STOCH", params={"k": 14, "d": 3}),
            IndicatorDef(name="ADX", params={"period": 14}),
        ],
        "entry_conditions": ["close > EMA_20 AND ADX_14 > 20"],
        "exit_conditions": ["STOCHK_14_3 > 80 OR close < EMA_20"],
    })
    bars = _make_bars()
    portfolio = await run_backtest(spec, bars)
    assert portfolio is not None


def test_or_condition_precedence():
    from core.backtest.engine import _combine_conditions

    idx = pd.date_range("2020-01-01", periods=4, freq="D")
    signals = {
        "A": pd.Series([1.0, 1.0, 0.0, 0.0], index=idx),
        "B": pd.Series([1.0, 0.0, 1.0, 0.0], index=idx),
    }
    # (A > 0.5 AND B > 0.5) OR B < 0.5 → [T, T, F, T]
    out = _combine_conditions(["A > 0.5 AND B > 0.5 OR B < 0.5"], signals)
    assert list(out) == [True, True, False, True]

    # List entries are AND-joined: (A > 0.5) AND (B > 0.5) → [T, F, F, F]
    out = _combine_conditions(["A > 0.5", "B > 0.5"], signals)
    assert list(out) == [True, False, False, False]


def test_empty_conditions_raise():
    from core.backtest.engine import _combine_conditions
    with pytest.raises(ValueError, match="no entry/exit conditions"):
        _combine_conditions([], {})
    with pytest.raises(ValueError, match="no entry/exit conditions"):
        _combine_conditions(["  "], {})


async def test_percent_equity_position_sizing():
    from core.backtest.engine import run_backtest
    spec = SMA_CROSSOVER_SPEC.model_copy(update={"position_sizing": "percent_equity"})
    bars = _make_bars()
    portfolio = await run_backtest(spec, bars)
    assert portfolio is not None


async def test_build_analytics_curves_and_trade_stats():
    from core.backtest.engine import run_backtest
    from core.backtest.metrics import build_analytics

    bars = _make_bars()
    portfolio = await run_backtest(SMA_CROSSOVER_SPEC, bars)
    analytics = build_analytics(portfolio, bars, init_cash=100_000.0)

    # Equity curve starts at init_cash and has one point per bar.
    equity = analytics["equity_curve"]
    assert len(equity) == len(bars["SPY"])
    assert equity[0]["v"] == pytest.approx(100_000.0)

    # Benchmark is buy-and-hold: first point == init_cash, last point matches
    # the raw price move of the single asset.
    bench = analytics["benchmark_curve"]
    close = bars["SPY"]["close"]
    assert bench[0]["v"] == pytest.approx(100_000.0)
    assert bench[-1]["v"] == pytest.approx(100_000.0 * close.iloc[-1] / close.iloc[0], rel=1e-6)
    assert analytics["metrics"]["benchmark_return"] == pytest.approx(
        (close.iloc[-1] / close.iloc[0] - 1) * 100, abs=0.01
    )

    # Drawdown is 0 at the running peak and never positive.
    dd_values = [p["v"] for p in analytics["drawdown_curve"]]
    assert max(dd_values) == pytest.approx(0.0)
    assert min(dd_values) <= 0.0

    # Trade stats exist whenever there are closed trades.
    if any(t["status"] == "closed" for t in analytics["trades"]):
        assert analytics["metrics"]["best_trade_pct"] is not None
        assert analytics["metrics"]["worst_trade_pct"] is not None


def test_trade_stats_profit_factor():
    from core.backtest.metrics import _trade_stats

    trades = [
        {"status": "closed", "pnl": 200.0, "return_pct": 2.0},
        {"status": "closed", "pnl": -100.0, "return_pct": -1.0},
        {"status": "closed", "pnl": 100.0, "return_pct": 1.0},
        {"status": "open", "pnl": None, "return_pct": None},
    ]
    stats = _trade_stats(trades)
    assert stats["profit_factor"] == pytest.approx(3.0)
    assert stats["avg_win_pct"] == pytest.approx(1.5)
    assert stats["avg_loss_pct"] == pytest.approx(-1.0)
    assert stats["best_trade_pct"] == pytest.approx(2.0)
    assert stats["worst_trade_pct"] == pytest.approx(-1.0)


def test_trade_stats_empty():
    from core.backtest.metrics import _trade_stats

    stats = _trade_stats([])
    assert all(v is None for v in stats.values())


def test_benchmark_curve_multi_asset_equal_weight():
    from core.backtest.metrics import compute_benchmark_curve

    idx = pd.date_range("2020-01-01", periods=3, freq="D")
    bars = {
        # +10% over the window
        "AAA": pd.DataFrame({"close": [100.0, 105.0, 110.0]}, index=idx),
        # -10% over the window
        "BBB": pd.DataFrame({"close": [50.0, 47.5, 45.0]}, index=idx),
    }
    curve = compute_benchmark_curve(bars, init_cash=10_000.0)
    assert curve[0]["v"] == pytest.approx(10_000.0)
    # Equal weight: (1.10 + 0.90) / 2 = 1.0 → flat overall
    assert curve[-1]["v"] == pytest.approx(10_000.0)


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
