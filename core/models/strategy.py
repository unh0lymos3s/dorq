from typing import Any
from pydantic import BaseModel


class IndicatorDef(BaseModel):
    name: str
    params: dict[str, Any]


class RiskParams(BaseModel):
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None


class StrategySpec(BaseModel):
    title: str
    summary: str
    assets: list[str]
    timeframe: str
    date_range: tuple[str, str]
    indicators: list[IndicatorDef]
    entry_conditions: list[str]
    exit_conditions: list[str]
    position_sizing: str
    risk_params: RiskParams
