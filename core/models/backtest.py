from typing import Literal

from pydantic import BaseModel

from core.models.strategy import StrategySpec


class BacktestRequest(BaseModel):
    # Alpaca credentials are read from the server environment, not the client.
    strategy_spec: StrategySpec


class PricePoint(BaseModel):
    t: str  # ISO timestamp
    c: float  # close price


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
    metrics: dict[str, float | int | str | None]
    charts: list[str]
    strategy_spec: StrategySpec | None = None
    price_series: dict[str, list[PricePoint]] = {}
    trades: list[TradeMarker] = []
