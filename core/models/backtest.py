from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from core.models.strategy import StrategySpec


class PricePoint(BaseModel):
    t: str  # ISO timestamp
    c: float  # close price


class CurvePoint(BaseModel):
    t: str  # ISO timestamp
    v: float  # curve value (equity in $, drawdown in percent points)


class TradeMarker(BaseModel):
    asset: str
    side: Literal["long", "short"]
    status: Literal["open", "closed"]
    entry_time: str
    entry_price: float
    exit_time: str | None = None
    exit_price: float | None = None
    pnl: float | None = None
    return_pct: float | None = None


class BacktestResult(BaseModel):
    backtest_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metrics: dict[str, float | int | str | None]
    strategy_spec: StrategySpec | None = None
    price_series: dict[str, list[PricePoint]] = {}
    trades: list[TradeMarker] = []
    # Portfolio value over time vs. equal-weight buy-and-hold of the same
    # assets, plus drawdown from running peak — the UI's interactive charts.
    equity_curve: list[CurvePoint] = []
    benchmark_curve: list[CurvePoint] = []
    drawdown_curve: list[CurvePoint] = []
