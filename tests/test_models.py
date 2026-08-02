"""Pydantic-layer guards on the strategy models."""

import pytest
from pydantic import ValidationError

from core.models.strategy import PortfolioConfig, StrategySpec


def _config(assets: list[str]) -> PortfolioConfig:
    return PortfolioConfig(
        assets=assets,
        timeframe="1D",
        date_range=("2020-01-01", "2021-01-01"),
        position_sizing="equal_weight",
        risk_params={},
    )


@pytest.mark.parametrize("bad", ["EURUSD=X", "BTC-USD/USD", "^GSPC", "", "1SPY"])
def test_rejects_untradeable_symbols(bad):
    with pytest.raises(ValidationError, match="invalid ticker"):
        _config([bad])


def test_normalizes_case_and_whitespace():
    cfg = _config([" spy ", "brk.b"])
    assert cfg.assets == ["SPY", "BRK.B"]


def test_spec_shares_the_ticker_guard():
    with pytest.raises(ValidationError, match="invalid ticker"):
        StrategySpec(
            title="t",
            summary="s",
            assets=["EURUSD=X"],
            timeframe="1D",
            date_range=("2020-01-01", "2021-01-01"),
            indicators=[],
            entry_conditions=[],
            exit_conditions=[],
            position_sizing="equal_weight",
            risk_params={},
        )
