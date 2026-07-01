from pydantic import BaseModel

from core.models.strategy import StrategySpec


class BacktestRequest(BaseModel):
    # Alpaca credentials are read from the server environment, not the client.
    strategy_spec: StrategySpec


class BacktestResult(BaseModel):
    backtest_id: str
    metrics: dict[str, float | int | str | None]
    charts: list[str]
    strategy_spec: StrategySpec | None = None
