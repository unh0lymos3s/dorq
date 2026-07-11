# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**dorq** is a research-to-strategy backtesting platform with a React frontend. A user uploads a research paper PDF (or URL); the system parses it, uses a **local Ollama model** to extract a tradeable strategy spec (or a sandboxed code strategy), fetches market data from Alpaca, runs a vectorbt backtest, and returns metrics plus JSON time series (equity, benchmark, drawdown, price, trades) via a FastAPI JSON API. The built SPA is served from `frontend/` (source in `ui/`).

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
PDF / URL → [docling] → Markdown → [LiteLLM] → StrategySpec → [vectorbt + Alpaca] → analytics (JSON)
```

All blocking calls (docling, Alpaca SDK, vectorbt, pandas analytics) must run in a thread pool via `asyncio.run_in_executor(None, ...)` — never block the event loop directly.

## Project Structure

```
dorq/
├── main.py                    # FastAPI app, lifespan, router registration, SPA serving
├── config.py                  # pydantic-settings Settings class (DORQ_* env)
├── api/routes/
│   ├── papers.py              # POST /papers/upload, POST /papers/url, GET /papers
│   ├── strategies.py          # POST /strategies/generate, POST /strategies/generate-code
│   ├── backtest.py            # POST /backtest/run, GET /backtest, GET /backtest/{id}
│   └── chat.py                # POST /chat — Q&A over paper and/or strategy
├── core/
│   ├── errors.py              # error-code constants + raise_http envelope helper
│   ├── stores.py              # LRUStore — bounded async in-memory stores
│   ├── document/
│   │   ├── parser.py          # docling: PDF bytes or URL → Markdown
│   │   └── extractor.py       # Heading-based section splitter → dict[str, str]
│   ├── llm/
│   │   ├── client.py          # LiteLLM async wrapper against local Ollama
│   │   ├── prompts.py         # Spec-mode + chat prompt templates
│   │   ├── code_prompts.py    # Code-mode prompt templates
│   │   ├── strategy_gen.py    # ParsedPaper → StrategySpec with retry logic
│   │   └── code_strategy_gen.py  # ParsedPaper → strategy_code + PortfolioConfig
│   ├── backtest/
│   │   ├── data.py            # Alpaca StockHistoricalDataClient → dict[str, DataFrame]
│   │   ├── engine.py          # spec/code + bars → vbt.Portfolio (fixed condition parser)
│   │   ├── validator.py       # AST allowlist for code-mode strategies
│   │   ├── executor.py        # sandboxed exec of validated strategy code
│   │   └── metrics.py         # build_analytics: metrics + equity/benchmark/drawdown/trades
│   └── models/
│       ├── paper.py           # PaperRecord, ParsedPaper
│       ├── strategy.py        # StrategySpec, PortfolioConfig, IndicatorDef, RiskParams
│       └── backtest.py        # BacktestResult, CurvePoint, TradeMarker, PricePoint
├── ui/                        # React + TypeScript SPA source (Vite → frontend/)
└── tests/
```

## Central Data Contract: StrategySpec

`StrategySpec` (defined in `core/models/strategy.py`) is the handoff between the LLM layer and the backtest engine. The LLM populates it; the engine consumes it deterministically.

```python
class StrategySpec(BaseModel):
    title: str
    summary: str
    assets: list[str]           # e.g. ["SPY", "TLT"]
    timeframe: str              # "1D" | "1W" | "1M"
    date_range: tuple[date, date]
    indicators: list[IndicatorDef]
    entry_conditions: list[str] # e.g. ["SMA_50 > SMA_200", "RSI_14 < 30"]
    exit_conditions: list[str]
    position_sizing: str        # "equal_weight" | "fixed" | "percent_equity"
    risk_params: RiskParams
    init_cash: float            # default 100_000
```

Entry/exit condition strings use a fixed format: `<INDICATOR_COL> <op> <INDICATOR_COL|number>` combined with `AND` / `OR` (AND binds tighter; list entries are AND-joined). The condition evaluator in `engine.py` is a narrow parser — only `>`, `<`, `>=`, `<=`, `==`, `AND`, `OR`. No `eval()`.

Supported indicators (see `_compute_indicators` and the prompt vocabulary, which must stay in sync): `SMA`, `EMA`, `RSI`, `MACD`, `BB`, `ATR`, `STOCH`, `ADX`. Raw `open/high/low/close` columns are always available in conditions.

`BacktestResult` carries `metrics` (percent-kind values are **percent points**, e.g. `12.34` = 12.34% — the UI formats them without rescaling), plus JSON time series: `equity_curve`, `benchmark_curve` (equal-weight buy-and-hold of the same assets), `drawdown_curve`, `price_series`, `trades`. All analytics are assembled by `core/backtest/metrics.py:build_analytics()` run in the thread pool.

## In-Memory State

Papers, strategies, and backtest results live in bounded `LRUStore`s on `app.state` (`papers`, `strategies`, `backtests`, maxsize 128 each). `GET /papers` and `GET /backtest` expose most-recent-first summaries for the UI's session history. No database for MVP.

## LLM: local Ollama

The server talks to a single **local Ollama instance** — clients never send a provider, model, or key. `core/llm/client.py:build_litellm_kwargs()` builds the LiteLLM call as `ollama_chat/{model}` against `settings.ollama_base_url`, with `format="json"` for structured extraction (omitted for free-form chat via `json_mode=False`). Model and host come from `DORQ_OLLAMA_MODEL` (**required**, no default — LLM routes return 503 `ollama_not_configured` until set; gated by `settings.ollama_configured`) and `DORQ_OLLAMA_BASE_URL` (default `http://localhost:11434`). Set the model to any tag your Ollama serves (`ollama pull <model>`), or an Ollama **cloud** tag proxied to ollama.com (run `ollama signin` first).

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
