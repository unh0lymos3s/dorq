"""Memory engine: disk persistence, reload, and search (keyword fallback)."""
from datetime import date

import pytest

from core.memory import MemoryEngine
from core.models.paper import PaperRecord, ParsedPaper
from core.models.strategy import PortfolioConfig, RiskParams, StrategySpec
from core.stores import LRUStore


@pytest.fixture
def engine(tmp_path):
    # No embed model → persistence works, search uses keyword fallback.
    return MemoryEngine(tmp_path / "memory", embed_model="")


def make_spec(title: str = "Momentum crossover") -> StrategySpec:
    return StrategySpec(
        title=title,
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


async def test_paper_roundtrip(engine):
    record = PaperRecord(paper_id="p1", filename="momentum.pdf")
    parsed = ParsedPaper(
        paper_id="p1",
        full_markdown="# Momentum\nCross-sectional momentum in equities.",
        sections={"abstract": "Momentum works."},
    )
    await engine.add_paper(record, parsed)

    papers = await engine.list_papers()
    assert len(papers) == 1
    assert papers[0]["paper_id"] == "p1"
    assert papers[0]["filename"] == "momentum.pdf"
    assert papers[0]["embedded"] is False

    doc = await engine.get_paper("p1")
    assert doc["full_markdown"].startswith("# Momentum")
    assert doc["sections"]["abstract"] == "Momentum works."


async def test_strategy_roundtrip_spec_and_code(engine):
    await engine.add_strategy("p1", "p1", spec=make_spec())
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

    strategies = await engine.list_strategies()
    assert {s["strategy_id"] for s in strategies} == {"p1", "p1:code"}
    by_id = {s["strategy_id"]: s for s in strategies}
    assert by_id["p1"]["kind"] == "spec"
    assert by_id["p1"]["title"] == "Momentum crossover"
    assert by_id["p1:code"]["kind"] == "code"
    assert by_id["p1:code"]["assets"] == ["QQQ"]


async def test_reload_into_stores(tmp_path):
    root = tmp_path / "memory"
    engine = MemoryEngine(root, embed_model="")
    record = PaperRecord(paper_id="p1", filename="a.pdf")
    parsed = ParsedPaper(paper_id="p1", full_markdown="# A", sections={})
    await engine.add_paper(record, parsed)
    await engine.add_strategy("p1", "p1", spec=make_spec())

    # Fresh engine over the same directory (simulates a restart).
    fresh = MemoryEngine(root, embed_model="")
    papers_store: LRUStore = LRUStore(maxsize=8)
    strategies_store: LRUStore = LRUStore(maxsize=8)
    n_papers, n_strategies = await fresh.reload_into(papers_store, strategies_store)

    assert (n_papers, n_strategies) == (1, 1)
    entry = await papers_store.get("p1")
    assert entry["record"].filename == "a.pdf"
    assert entry["parsed"].full_markdown == "# A"
    spec = await strategies_store.get("p1")
    assert isinstance(spec, StrategySpec)
    assert spec.title == "Momentum crossover"


async def test_keyword_search_fallback(engine):
    await engine.add_paper(
        PaperRecord(paper_id="p1"),
        ParsedPaper(paper_id="p1", full_markdown="Volatility risk premium in options markets", sections={}),
    )
    await engine.add_paper(
        PaperRecord(paper_id="p2"),
        ParsedPaper(paper_id="p2", full_markdown="Equity momentum and trend following", sections={}),
    )
    await engine.add_strategy("p2", "p2", spec=make_spec("Trend following momentum"))

    hits = await engine.search("momentum trend")
    assert hits, "expected keyword hits"
    top_ids = [h["id"] for h in hits]
    assert "p1" not in top_ids  # unrelated paper filtered out (score 0)
    assert set(top_ids) <= {"p2"} or len(top_ids) == 2  # paper + strategy for p2

    # Both p2 entries should rank; scores in [0, 1]
    assert all(0 < h["score"] <= 1 for h in hits)


async def test_search_empty_store(engine):
    assert await engine.search("anything") == []


async def test_safe_filenames(engine, tmp_path):
    # IDs with path-hostile characters must not escape the memory directory.
    record = PaperRecord(paper_id="../../evil")
    parsed = ParsedPaper(paper_id="../../evil", full_markdown="x", sections={})
    await engine.add_paper(record, parsed)
    files = list((tmp_path / "memory" / "papers").glob("*.json"))
    assert len(files) == 1
    # Nothing escaped the papers/ directory.
    strays = [p for p in tmp_path.rglob("*.json") if "papers" not in p.parts]
    assert strays == []
    assert (await engine.get_paper("../../evil"))["paper_id"] == "../../evil"
