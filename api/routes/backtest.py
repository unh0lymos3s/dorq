import uuid

import sentry_sdk
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, SecretStr

from core.backtest.data import fetch_bars
from core.backtest.engine import run_backtest
from core.backtest.metrics import extract_metrics, render_charts
from core.models.backtest import BacktestRequest, BacktestResult
from core.models.strategy import StrategySpec

router = APIRouter(prefix="/backtest", tags=["backtest"])


class BacktestRunBody(BaseModel):
    strategy_spec: StrategySpec
    alpaca_api_key: SecretStr
    alpaca_secret_key: SecretStr


@router.post("/run", response_model=BacktestResult)
async def run_backtest_route(request: Request, body: BacktestRunBody):
    spec = body.strategy_spec
    sentry_sdk.set_context("strategy", {
        "assets": spec.assets,
        "timeframe": spec.timeframe,
        "date_range": [str(d) for d in spec.date_range],
        "position_sizing": spec.position_sizing,
    })
    sentry_sdk.set_tag("backtest.timeframe", spec.timeframe)
    sentry_sdk.set_tag("backtest.assets", ",".join(spec.assets))

    api_key = body.alpaca_api_key.get_secret_value()
    secret_key = body.alpaca_secret_key.get_secret_value()

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
