from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

IndicatorParam = float | int | str | bool
Timeframe = Literal["1D", "1W", "1M"]
PositionSizing = Literal["equal_weight", "fixed", "percent_equity"]


class IndicatorDef(BaseModel):
    name: str
    params: dict[str, IndicatorParam]


class RiskParams(BaseModel):
    # Percent points (5 = 5%). Bounded so a hallucinated value can't produce
    # a nonsensical vectorbt stop (engine divides by 100 → must stay in (0, 1]
    # for stops; take-profit may exceed 100%).
    stop_loss_pct: float | None = Field(default=None, gt=0, le=100)
    take_profit_pct: float | None = Field(default=None, gt=0, le=1000)


class _PortfolioBase(BaseModel):
    assets: list[str] = Field(min_length=1, max_length=20)
    timeframe: Timeframe
    date_range: tuple[date, date]
    position_sizing: PositionSizing
    risk_params: RiskParams
    init_cash: float = Field(default=100_000.0, gt=0)

    @model_validator(mode="after")
    def _check_date_range(self) -> "_PortfolioBase":
        if self.date_range[0] >= self.date_range[1]:
            raise ValueError("date_range start must be before end")
        return self


class PortfolioConfig(_PortfolioBase):
    pass


class StrategySpec(_PortfolioBase):
    title: str
    summary: str
    indicators: list[IndicatorDef]
    entry_conditions: list[str]
    exit_conditions: list[str]
