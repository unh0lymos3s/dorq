# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**dorq** is a research-to-strategy backtesting platform with a React frontend. A user uploads a research paper PDF (or URL); the system parses it, uses a **local Ollama model** to extract a tradeable strategy spec, fetches market data from Alpaca, runs a vectorbt backtest, and returns metrics + base64 chart images via a FastAPI JSON API. The built SPA is served from `frontend/` (source in `ui/`).

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

## LLM: local Ollama

The server talks to a single **local Ollama instance** — clients never send a provider, model, or key. `core/llm/client.py:build_litellm_kwargs()` builds the LiteLLM call as `ollama_chat/{model}` against `settings.ollama_base_url`, with `format="json"` for structured extraction (omitted for free-form chat via `json_mode=False`). Model and host come from `DORQ_OLLAMA_MODEL` (default `minimax-m3:cloud`) and `DORQ_OLLAMA_BASE_URL` (default `http://localhost:11434`). The default is an Ollama **cloud** model — the local ollama proxies it to ollama.com, so run `ollama signin` first. For a fully local model, `ollama pull <model>` and set `DORQ_OLLAMA_MODEL` to its tag.

On invalid/unparseable JSON from the model, `strategy_gen.py` retries once with a stricter prompt. If both attempts fail, it raises `ValueError("llm_invalid_json")`.

## Credentials (env-only)

All credentials are read from the server environment via `config.Settings` (prefix `DORQ_`) — nothing is accepted from the client:
- `DORQ_ALPACA_API_KEY` / `DORQ_ALPACA_SECRET_KEY` — market data. `settings.alpaca_configured` gates `/backtest/run`.
- `DORQ_OLLAMA_MODEL` / `DORQ_OLLAMA_BASE_URL` — the local model.

`GET /config` exposes the non-secret runtime config (`ollama_model`, `alpaca_configured`) so the UI can show status without any keys.

## Error Handling Conventions

- `raise_http(status, code, detail)` returns a `{"error": code, "detail": detail}` envelope — no raw stack traces.
- `ValueError("docling_parse_error: ...")` → 422
- `ValueError("llm_invalid_json")` → 422
- `ValueError("alpaca_fetch_error: ...")` → 422
- Alpaca keys unset → 503 `"alpaca_not_configured"`
- Ollama unreachable on chat → 502 `"llm_error"`
- vectorbt runtime errors → 500 with `"backtest_runtime_error"` (sanitized)

## Design Constraints (Non-Negotiable)

- **No LLM-generated code execution.** The condition evaluator is a fixed parser, not `eval()` or `exec()`.
- **Credentials come from the server env only** — never from the client/request body.
- **No database.** In-memory dicts on `app.state` for MVP.
- **Async throughout.** All blocking I/O runs in `run_in_executor`.
