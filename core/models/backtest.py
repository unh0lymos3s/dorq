from pydantic import BaseModel

from core.models.strategy import StrategySpec


class BacktestRequest(BaseModel):
    strategy_spec: StrategySpec
    alpaca_api_key: str
    alpaca_secret_key: str


class BacktestResult(BaseModel):
    backtest_id: str
    metrics: dict[str, float | None]
    charts: list[str]
