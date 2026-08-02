"""Semantic guardrails over LLM-generated StrategySpecs."""
from datetime import date

import pytest
from pydantic import ValidationError

from core.llm.spec_guard import SpecGuardError, validate_spec
from core.models.strategy import RiskParams, StrategySpec


def make_spec(**overrides) -> StrategySpec:
    base = dict(
        title="Momentum",
        summary="SMA crossover.",
        assets=["SPY"],
        timeframe="1D",
        date_range=(date(2020, 1, 1), date(2021, 1, 1)),
        indicators=[
            {"name": "SMA", "params": {"period": 50}},
            {"name": "SMA", "params": {"period": 200}},
            {"name": "RSI", "params": {"period": 14}},
        ],
        entry_conditions=["SMA_50 > SMA_200", "RSI_14 < 30"],
        exit_conditions=["SMA_50 < SMA_200 OR RSI_14 > 70"],
        position_sizing="equal_weight",
        risk_params=RiskParams(),
    )
    base.update(overrides)
    return StrategySpec(**base)


def test_valid_spec_passes():
    validate_spec(make_spec())


def test_all_indicator_column_families():
    spec = make_spec(
        indicators=[
            {"name": "EMA", "params": {"period": 20}},
            {"name": "MACD", "params": {"fast": 12, "slow": 26, "signal": 9}},
            {"name": "BB", "params": {"period": 20}},
            {"name": "ATR", "params": {"period": 14}},
            {"name": "STOCH", "params": {"k": 14, "d": 3}},
            {"name": "ADX", "params": {"period": 14}},
        ],
        entry_conditions=[
            "MACD_12_26_9 > MACDs_12_26_9 AND close > BBL_20",
            "STOCHK_14_3 > STOCHD_14_3",
            "ADX_14 > 25 AND DMP_14 > DMN_14",
        ],
        exit_conditions=["close > BBU_20 OR ATR_14 > 5"],
    )
    validate_spec(spec)


def test_unknown_indicator_rejected():
    with pytest.raises(SpecGuardError, match="unsupported indicator"):
        validate_spec(make_spec(indicators=[{"name": "VWAP", "params": {"period": 20}}]))


def test_missing_param_rejected():
    with pytest.raises(SpecGuardError, match="missing required param"):
        validate_spec(make_spec(indicators=[{"name": "MACD", "params": {"fast": 12}}]))


def test_param_out_of_range_rejected():
    with pytest.raises(SpecGuardError, match="out of range"):
        validate_spec(make_spec(indicators=[{"name": "SMA", "params": {"period": 100000}}]))


def test_condition_referencing_undeclared_column_rejected():
    with pytest.raises(SpecGuardError, match="unknown signal"):
        validate_spec(make_spec(entry_conditions=["SMA_99 > close"]))


def test_unparseable_condition_rejected():
    with pytest.raises(SpecGuardError, match="unparseable"):
        validate_spec(make_spec(entry_conditions=["close crossed above SMA_50"]))


def test_injection_style_condition_rejected():
    with pytest.raises(SpecGuardError):
        validate_spec(make_spec(entry_conditions=["__import__('os').system('id') > 0"]))


def test_empty_conditions_rejected():
    with pytest.raises(SpecGuardError, match="at least one"):
        validate_spec(make_spec(entry_conditions=["", "  "]))


def test_bad_ticker_rejected():
    # The ticker guard moved to the pydantic layer (shared with PortfolioConfig),
    # so a bad symbol never survives long enough for validate_spec to see it.
    with pytest.raises(ValidationError, match="invalid ticker"):
        make_spec(assets=["spy; drop table"])


def test_dotted_ticker_allowed():
    validate_spec(make_spec(assets=["BRK.B"]))


def test_raw_price_columns_always_available():
    validate_spec(make_spec(indicators=[], entry_conditions=["close > open"],
                            exit_conditions=["close < low"]))
