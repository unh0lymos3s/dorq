import logging
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, SecretStr, model_validator

from core.backtest.data import fetch_bars
from core.backtest.engine import run_backtest, run_backtest_from_code
from core.backtest.metrics import extract_metrics, render_charts
from core.models.backtest import BacktestResult
from core.models.strategy import PortfolioConfig, StrategySpec

router = APIRouter(prefix="/backtest", tags=["backtest"])
logger = logging.getLogger("dorq." + __name__)


class BacktestRunBody(BaseModel):
    mode: Literal["spec", "code"] = "spec"
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
        logger.info("backtest.fetch_bars failed assets=%s error=%s", src.assets, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    try:
        if body.mode == "spec":
            portfolio = await run_backtest(body.strategy_spec, bars)
        else:
            portfolio = await run_backtest_from_code(body.portfolio_config, body.strategy_code, bars)
    except ValueError as exc:
        logger.info("backtest.run failed mode=%s error=%s", body.mode, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:
        logger.error("backtest.run error mode=%s", body.mode, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "backtest_runtime_error") from exc

    metrics = extract_metrics(portfolio)
    charts = render_charts(portfolio)

    result = BacktestResult(
        backtest_id=str(uuid.uuid4()),
        metrics=metrics,
        charts=charts,
    )
    await request.app.state.backtests.put(result.backtest_id, result)
    logger.info("backtest.done backtest_id=%s total_return=%s num_trades=%s",
                result.backtest_id, metrics.get("total_return"), metrics.get("num_trades"))
    return result


@router.get("/{backtest_id}", response_model=BacktestResult)
async def get_backtest(request: Request, backtest_id: str):
    result = await request.app.state.backtests.get(backtest_id)
    if result is None:
        logger.info("backtest.get not_found backtest_id=%s", backtest_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"backtest {backtest_id!r} not found")
    return result
