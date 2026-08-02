"""GET /memory/strategies/{id} — full-document recall for the UI restore flow."""
from datetime import date

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.routes.memory import router as memory_router
from core.memory import MemoryEngine
from core.models.strategy import PortfolioConfig, RiskParams, StrategySpec


def make_app(engine: MemoryEngine) -> FastAPI:
    app = FastAPI()
    app.include_router(memory_router)
    app.state.memory = engine
    return app


@pytest.fixture
async def client(tmp_path):
    engine = MemoryEngine(tmp_path / "memory", embed_model="")
    spec = StrategySpec(
        title="Momentum crossover",
        summary="Buy SPY when the fast SMA crosses above the slow SMA.",
        assets=["SPY"],
        timeframe="1D",
        date_range=(date(2020, 1, 1), date(2021, 1, 1)),
        indicators=[{"name": "SMA", "params": {"period": 50}}],
        entry_conditions=["SMA_50 > close"],
        exit_conditions=["SMA_50 < close"],
        position_sizing="equal_weight",
        risk_params=RiskParams(),
    )
    await engine.add_strategy("p1", "p1", spec=spec)
    config = PortfolioConfig(
        assets=["QQQ"], timeframe="1D",
        date_range=(date(2020, 1, 1), date(2021, 1, 1)),
        position_sizing="equal_weight", risk_params=RiskParams(),
    )
    await engine.add_strategy(
        "p1:code", "p1",
        strategy_code="def strategy(bars):\n    return None, None",
        portfolio_config=config.model_dump(mode="json"),
    )
    transport = ASGITransport(app=make_app(engine))
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_get_spec_strategy(client):
    res = await client.get("/memory/strategies/p1")
    assert res.status_code == 200
    doc = res.json()
    assert doc["kind"] == "spec"
    assert doc["paper_id"] == "p1"
    assert doc["spec"]["title"] == "Momentum crossover"
    assert "embedding" not in doc


async def test_get_code_strategy(client):
    res = await client.get("/memory/strategies/p1:code")
    assert res.status_code == 200
    doc = res.json()
    assert doc["kind"] == "code"
    assert doc["strategy_code"].startswith("def strategy")
    assert doc["portfolio_config"]["assets"] == ["QQQ"]


async def test_get_missing_strategy_404(client):
    res = await client.get("/memory/strategies/nope")
    assert res.status_code == 404
    assert res.json()["detail"]["error"] == "not_found"
