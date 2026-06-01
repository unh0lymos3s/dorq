from pydantic import BaseModel, SecretStr

from core.models.strategy import StrategySpec


class BacktestRequest(BaseModel):
    strategy_spec: StrategySpec
    alpaca_api_key: SecretStr
    alpaca_secret_key: SecretStr


class BacktestResult(BaseModel):
    backtest_id: str
    metrics: dict[str, float | int | str | None]
    charts: list[str]
    strategy_spec: StrategySpec | None = None
