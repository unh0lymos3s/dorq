import uuid
from typing import Literal

import sentry_sdk
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, SecretStr, model_validator

from core.backtest.data import fetch_bars
from core.backtest.engine import run_backtest, run_backtest_from_code
from core.backtest.metrics import extract_metrics, render_charts
from core.models.backtest import BacktestResult
from core.models.strategy import PortfolioConfig, StrategySpec

router = APIRouter(prefix="/backtest", tags=["backtest"])


class BacktestRunBody(BaseModel):
    mode: Literal["spec", "code"] = "code"
    strategy_spec: StrategySpec | None = None
    portfolio_config: PortfolioConfig | None = None
    strategy_code: str | None = None
    alpaca_api_key: SecretStr
    alpaca_secret_key: SecretStr

    @model_validator(mode="after")
    def _check_payload(self) -> "BacktestRunBody":
        if self.mode == "spec" and self.strategy_spec is None:
            raise ValueError("strategy_spec required when mode='spec'")
        if self.mode == "code" and (self.portfolio_config is None or self.strategy_code is None):
            raise ValueError("portfolio_config and strategy_code required when mode='code'")
        return self


@router.post("/run", response_model=BacktestResult)
async def run_backtest_route(request: Request, body: BacktestRunBody):
    api_key = body.alpaca_api_key.get_secret_value()
    secret_key = body.alpaca_secret_key.get_secret_value()

    if body.mode == "spec":
        spec = body.strategy_spec
        sentry_sdk.set_context("strategy", {
            "assets": spec.assets,
            "timeframe": spec.timeframe,
            "date_range": [str(d) for d in spec.date_range],
            "position_sizing": spec.position_sizing,
            "mode": "spec",
        })
        sentry_sdk.set_tag("backtest.timeframe", spec.timeframe)
        sentry_sdk.set_tag("backtest.assets", ",".join(spec.assets))
        sentry_sdk.set_tag("backtest.mode", "spec")

        try:
            bars = await fetch_bars(
                assets=spec.assets,
                start=spec.date_range[0],
                end=spec.date_range[1],
                timeframe=spec.timeframe,
                api_key=api_key,
                secret_key=secret_key,
            )
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

        try:
            portfolio = await run_backtest(spec, bars)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "backtest_runtime_error") from exc

    else:  # mode == "code"
        cfg = body.portfolio_config
        sentry_sdk.set_context("strategy", {
            "assets": cfg.assets,
            "timeframe": cfg.timeframe,
            "date_range": [str(d) for d in cfg.date_range],
            "position_sizing": cfg.position_sizing,
            "mode": "code",
            "strategy_code_length": len(body.strategy_code),
        })
        sentry_sdk.set_tag("backtest.timeframe", cfg.timeframe)
        sentry_sdk.set_tag("backtest.assets", ",".join(cfg.assets))
        sentry_sdk.set_tag("backtest.mode", "code")

        try:
            bars = await fetch_bars(
                assets=cfg.assets,
                start=cfg.date_range[0],
                end=cfg.date_range[1],
                timeframe=cfg.timeframe,
                api_key=api_key,
                secret_key=secret_key,
            )
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

        try:
            portfolio = await run_backtest_from_code(cfg, body.strategy_code, bars)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "backtest_runtime_error") from exc

    metrics = extract_metrics(portfolio)
    charts = render_charts(portfolio)

    result = BacktestResult(
        backtest_id=str(uuid.uuid4()),
        metrics=metrics,
        charts=charts,
    )
    await request.app.state.backtests.put(result.backtest_id, result)
    return result


@router.get("/{backtest_id}", response_model=BacktestResult)
async def get_backtest(request: Request, backtest_id: str):
    result = await request.app.state.backtests.get(backtest_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"backtest {backtest_id!r} not found")
    return result
