import asyncio
import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, model_validator

from config import settings
from core.backtest.data import fetch_bars
from core.backtest.engine import run_backtest, run_backtest_from_code
from core.backtest.metrics import build_analytics, extract_price_series, render_charts
from core.errors import (
    ERR_ALPACA_FETCH,
    ERR_ALPACA_NOT_CONFIGURED,
    ERR_BACKTEST_RUNTIME,
    raise_http,
)
from core.models.backtest import BacktestResult
from core.models.strategy import PortfolioConfig, StrategySpec

router = APIRouter(prefix="/backtest", tags=["backtest"])
logger = logging.getLogger("dorq." + __name__)


class BacktestRunBody(BaseModel):
    mode: Literal["spec", "code"] = "spec"
    strategy_spec: StrategySpec | None = None
    portfolio_config: PortfolioConfig | None = None
    strategy_code: str | None = None

    @model_validator(mode="after")
    def _check_payload(self) -> "BacktestRunBody":
        if self.mode == "spec" and self.strategy_spec is None:
            raise ValueError("strategy_spec required when mode='spec'")
        if self.mode == "code" and (self.portfolio_config is None or self.strategy_code is None):
            raise ValueError("portfolio_config and strategy_code required when mode='code'")
        return self


@router.post("/run", response_model=BacktestResult)
async def run_backtest_route(request: Request, body: BacktestRunBody):
    if not settings.alpaca_configured:
        logger.info("backtest.start blocked reason=alpaca_not_configured")
        raise_http(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            ERR_ALPACA_NOT_CONFIGURED,
            "Alpaca keys aren't set on the server. Add DORQ_ALPACA_API_KEY and "
            "DORQ_ALPACA_SECRET_KEY to the environment.",
        )
    api_key = settings.alpaca_api_key
    secret_key = settings.alpaca_secret_key

    src = body.strategy_spec if body.mode == "spec" else body.portfolio_config
    logger.info("backtest.start mode=%s assets=%s timeframe=%s", body.mode, src.assets, src.timeframe)

    try:
        bars = await fetch_bars(
            assets=src.assets,
            start=src.date_range[0],
            end=src.date_range[1],
            timeframe=src.timeframe,
            api_key=api_key,
            secret_key=secret_key,
        )
    except ValueError as exc:
        msg = str(exc)
        logger.info("backtest.fetch_bars failed assets=%s error=%s", src.assets, msg)
        # Extract the detail portion after the error code prefix if present
        detail = msg.split(": ", 1)[1] if ": " in msg else msg
        raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_ALPACA_FETCH, detail)

    try:
        if body.mode == "spec":
            portfolio = await run_backtest(body.strategy_spec, bars)
        else:
            portfolio = await run_backtest_from_code(body.portfolio_config, body.strategy_code, bars)
    except ValueError as exc:
        msg = str(exc)
        logger.info("backtest.run failed mode=%s error=%s", body.mode, msg)
        raise_http(status.HTTP_422_UNPROCESSABLE_ENTITY, ERR_BACKTEST_RUNTIME, msg)
    except Exception as exc:
        logger.error("backtest.run error mode=%s", body.mode, exc_info=True)
        raise_http(status.HTTP_500_INTERNAL_SERVER_ERROR, ERR_BACKTEST_RUNTIME, "backtest_runtime_error")

    # Analytics and chart rendering are blocking pandas/plotly work — keep
    # them off the event loop like every other heavy call in this route.
    loop = asyncio.get_running_loop()
    analytics = await loop.run_in_executor(None, build_analytics, portfolio, bars, src.init_cash)
    charts = await loop.run_in_executor(None, render_charts, portfolio)
    price_series = await loop.run_in_executor(None, extract_price_series, bars)

    # Attach strategy_spec only for spec-mode runs (code-mode has no StrategySpec).
    saved_spec: StrategySpec | None = body.strategy_spec if body.mode == "spec" else None

    result = BacktestResult(
        backtest_id=str(uuid.uuid4()),
        charts=charts,
        strategy_spec=saved_spec,
        price_series=price_series,
        **analytics,
    )
    await request.app.state.backtests.put(result.backtest_id, result)
    logger.info("backtest.done backtest_id=%s total_return=%s num_trades=%s",
                result.backtest_id, result.metrics.get("total_return"), result.metrics.get("num_trades"))
    return result


@router.get("/{backtest_id}", response_model=BacktestResult)
async def get_backtest(request: Request, backtest_id: str):
    result = await request.app.state.backtests.get(backtest_id)
    if result is None:
        logger.info("backtest.get not_found backtest_id=%s", backtest_id)
        raise_http(status.HTTP_404_NOT_FOUND, "not_found", f"backtest {backtest_id!r} not found")
    return result
