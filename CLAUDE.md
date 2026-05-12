# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**dorq** is a backend-only research-to-strategy backtesting platform. A user uploads a research paper PDF (or URL); the system parses it, uses an LLM to extract a tradeable strategy spec, fetches market data from Alpaca, runs a vectorbt backtest, and returns metrics + base64 chart images via a FastAPI JSON API.

## Development Commands

```bash
# Install dependencies
uv sync --dev

# Run the server
uv run uvicorn main:app --reload

# Run all tests
uv run pytest

# Run a single test file
uv run pytest tests/test_parser.py -v

# Add a new dependency
uv add <package>

# Run integration test (requires ALPACA_API_KEY and ALPACA_SECRET_KEY env vars)
uv run pytest tests/test_backtest.py -v
```

The integration test in `tests/test_backtest.py` is skipped automatically if `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` are absent from the environment.

## Architecture

```
PDF / URL → [docling] → Markdown → [LiteLLM] → StrategySpec → [vectorbt + Alpaca] → metrics + charts
```

All blocking calls (docling, Alpaca SDK, vectorbt) must run in a thread pool via `asyncio.run_in_executor(None, ...)` — never block the event loop directly.

## Project Structure

```
dorq/
├── main.py                    # FastAPI app, lifespan, router registration
├── config.py                  # pydantic-settings Settings class
├── requirements.txt
├── api/routes/
│   ├── papers.py              # POST /papers/upload, POST /papers/url
│   ├── strategies.py          # POST /strategies/generate
│   └── backtest.py            # POST /backtest/run, GET /backtest/{id}
├── core/
│   ├── document/
│   │   ├── parser.py          # docling: PDF bytes or URL → Markdown
│   │   └── extractor.py       # Heading-based section splitter → dict[str, str]
│   ├── llm/
│   │   ├── client.py          # LiteLLM async wrapper + provider/key injection
│   │   ├── prompts.py         # System + user prompt templates
│   │   └── strategy_gen.py    # ParsedPaper → StrategySpec with retry logic
│   ├── backtest/
│   │   ├── data.py            # Alpaca StockHistoricalDataClient → dict[str, DataFrame]
│   │   ├── engine.py          # StrategySpec + bars → vbt.Portfolio
│   │   └── metrics.py         # Portfolio → metrics dict + base64 chart list
│   └── models/
│       ├── paper.py           # PaperRecord, ParsedPaper
│       ├── strategy.py        # StrategySpec, IndicatorDef, RiskParams
│       └── backtest.py        # BacktestRequest, BacktestResult
└── tests/
    ├── test_parser.py
    ├── test_strategy_gen.py
    └── test_backtest.py
```

## Central Data Contract: StrategySpec

`StrategySpec` (defined in `core/models/strategy.py`) is the handoff between the LLM layer and the backtest engine. The LLM populates it; the engine consumes it deterministically.

```python
class StrategySpec(BaseModel):
    title: str
    summary: str
    assets: list[str]           # e.g. ["SPY", "TLT"]
    timeframe: str              # "1D" | "1W" | "1M"
    date_range: tuple[str, str] # ISO date strings
    indicators: list[IndicatorDef]
    entry_conditions: list[str] # e.g. ["SMA_50 > SMA_200", "RSI_14 < 30"]
    exit_conditions: list[str]
    position_sizing: str        # "equal_weight" | "fixed" | "percent_equity"
    risk_params: RiskParams
```

Entry/exit condition strings use a fixed format: `<INDICATOR_COL> <op> <INDICATOR_COL|number>` joined by `AND`. The condition evaluator in `engine.py` is a narrow parser — only `>`, `<`, `>=`, `<=`, `==` and `AND` are supported. No `eval()`.

## In-Memory State

Papers and backtest results are stored in `app.state.papers: dict[str, ParsedPaper]` and `app.state.backtests: dict[str, BacktestResult]`. No database for MVP.

## LLM Provider Handling

LiteLLM model strings follow the format `provider/model` (e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4-6`). Provider, model, and API key are passed per-request — no server-side key storage. `response_format={"type": "json_object"}` is added for providers that support JSON mode (openai, groq); others fall back to text parsing.

On invalid/unparseable JSON from the LLM, `strategy_gen.py` retries once with a stricter prompt. If both attempts fail, it raises `ValueError("llm_invalid_json")`.

## Error Handling Conventions

- All `HTTPException` details are plain strings — no raw stack traces in responses.
- `ValueError("docling_parse_error: ...")` → 422
- `ValueError("llm_invalid_json")` → 422
- `ValueError("alpaca_fetch_error: ...")` → 422
- vectorbt runtime errors → 500 with `"backtest_runtime_error"` (sanitized)

## Design Constraints (Non-Negotiable)

- **No LLM-generated code execution.** The condition evaluator is a fixed parser, not `eval()` or `exec()`.
- **No server-side key storage.** All API keys (LLM provider, Alpaca) are request-scoped only.
- **No database.** In-memory dicts on `app.state` for MVP.
- **Async throughout.** All blocking I/O runs in `run_in_executor`.
