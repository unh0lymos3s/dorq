from datetime import date
from pydantic import BaseModel, model_validator

IndicatorParam = float | int | str | bool


class IndicatorDef(BaseModel):
    name: str
    params: dict[str, IndicatorParam]


class RiskParams(BaseModel):
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None


class StrategySpec(BaseModel):
    title: str
    summary: str
    assets: list[str]
    timeframe: str
    date_range: tuple[date, date]
    indicators: list[IndicatorDef]
    entry_conditions: list[str]
    exit_conditions: list[str]
    position_sizing: str
    risk_params: RiskParams

    @model_validator(mode="after")
    def _check_date_range(self) -> "StrategySpec":
        start, end = self.date_range
        if start >= end:
            raise ValueError("date_range start must be before end")
        return self


class PortfolioConfig(BaseModel):
    assets: list[str]
    timeframe: str
    date_range: tuple[date, date]
    position_sizing: str
    risk_params: RiskParams

    @model_validator(mode="after")
    def _check_date_range(self) -> "PortfolioConfig":
        start, end = self.date_range
        if start >= end:
            raise ValueError("date_range start must be before end")
        return self
