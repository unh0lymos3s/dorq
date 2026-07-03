# dorq

**Turn a research paper into a backtested trading strategy.**

Drop in a paper (PDF or URL). dorq parses it, has a local LLM extract a
tradeable strategy, runs the strategy against real historical market data,
and shows you whether the idea actually beats buy-and-hold — with an
interactive equity curve, drawdown, trade log, and a chat panel for
interrogating the paper and the strategy.

```
PDF / URL → [docling] → Markdown → [local Ollama LLM] → StrategySpec → [vectorbt + Alpaca] → analytics
```

Everything runs on your machine: the LLM is a local Ollama instance and the
only external call is Alpaca's free market-data API. No keys ever leave the
server environment.

---

## The workflow

1. **Upload paper** — a PDF file or a URL (e.g. an arXiv link). docling
   converts it to Markdown and dorq extracts the abstract / methodology /
   results sections.
2. **Generate strategy** — two modes:
   - **Strategy spec** (default): the model produces a structured
     `StrategySpec` — indicators, entry/exit rules, assets, date range —
     that a deterministic engine executes. No model-written code runs.
     The generated conditions are shown and *editable* before you run.
   - **Code strategy**: the model writes a pandas `strategy()` function that
     you can inspect and edit; it executes in a restricted sandbox
     (AST-validated, no imports, no filesystem/network).
3. **Run backtest** — adjust assets, date range, position sizing, stop
   loss / take profit, initial cash; run as many variations as you like.
4. **Results** — total return vs. an equal-weight buy-and-hold benchmark,
   interactive equity + drawdown charts, Sharpe/Sortino/profit factor and
   friends, per-trade log, entry/exit markers on the price chart, and
   run-by-run comparison pills. Ask the model follow-up questions about the
   paper or the strategy in the chat panel.

## Quick start

Prerequisites:

- **Python 3.12** (not 3.13+; required by vectorbt/llvmlite)
- **[uv](https://docs.astral.sh/uv/)** — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **[Ollama](https://ollama.com)** running locally
- **Alpaca** paper-trading keys (free) for market data

```bash
git clone https://github.com/unh0lymos3s/dorq.git
cd dorq
uv sync --dev

# credentials & model (server env only — the client never sends keys)
export DORQ_ALPACA_API_KEY=...
export DORQ_ALPACA_SECRET_KEY=...
export DORQ_OLLAMA_MODEL=minimax-m3:cloud   # or any local tag you've pulled

uv run uvicorn main:app --port 8000
```

Open **http://localhost:8000**.

> The default model is an Ollama **cloud** model — your local Ollama proxies
> it to ollama.com, so run `ollama signin` once. For a fully local setup,
> `ollama pull <model>` and set `DORQ_OLLAMA_MODEL` to its tag.

## Configuration

All settings come from the server environment (prefix `DORQ_`), or a `.env`
file in the repo root:

| Variable | Default | Description |
|----------|---------|-------------|
| `DORQ_ALPACA_API_KEY` | — | Alpaca market-data key. Backtests are disabled until set. |
| `DORQ_ALPACA_SECRET_KEY` | — | Alpaca secret. |
| `DORQ_OLLAMA_MODEL` | `minimax-m3:cloud` | Model tag Ollama serves. |
| `DORQ_OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama host. |
| `DORQ_LLM_TIMEOUT` | `600` | Per-request LLM timeout (seconds). |
| `DORQ_LOG_LEVEL` | `info` | `debug` \| `info` \| `warning` \| `error` \| `critical` |
| `DORQ_CORS_ORIGINS` | `["*"]` | Allowed CORS origins (JSON array). |

`GET /config` exposes the non-secret runtime config so the UI can show
status without any keys.

## API

The UI is a thin client over a JSON API you can drive directly:

| Endpoint | Purpose |
|----------|---------|
| `POST /papers/upload` | multipart PDF → parsed paper (`paper_id`) |
| `POST /papers/url` | `{url}` → parsed paper |
| `GET /papers` | session paper history |
| `POST /strategies/generate` | `{paper_id}` → `StrategySpec` |
| `POST /strategies/generate-code` | `{paper_id}` → sandboxed `strategy_code` + `portfolio_config` |
| `POST /backtest/run` | spec or code + params → full `BacktestResult` |
| `GET /backtest` | session run history (lightweight summaries) |
| `GET /backtest/{id}` | full stored result |
| `POST /chat` | Q&A over a paper and/or a run's strategy |
| `GET /healthz`, `GET /config` | liveness / non-secret runtime config |

A `BacktestResult` includes `metrics` (returns, Sharpe, Sortino, Calmar,
max drawdown, win rate, profit factor, avg win/loss, best/worst trade,
benchmark return), `equity_curve`, `benchmark_curve`, `drawdown_curve`,
per-asset `price_series`, and a `trades` list — all JSON time series the
UI renders client-side.

Errors use a uniform envelope: `{"error": "<code>", "detail": "<human text>"}`.

### Strategy spec vocabulary

The deterministic engine supports these indicators and produces these
condition columns:

| Indicator | Params | Columns |
|-----------|--------|---------|
| `SMA` / `EMA` | `period` | `SMA_20`, `EMA_50`, … |
| `RSI` | `period` | `RSI_14` |
| `MACD` | `fast, slow, signal` | `MACD_12_26_9`, `MACDs_12_26_9` |
| `BB` | `period` | `BBU_20`, `BBM_20`, `BBL_20` |
| `ATR` | `period` | `ATR_14` |
| `STOCH` | `k, d` | `STOCHK_14_3`, `STOCHD_14_3` |
| `ADX` | `period` | `ADX_14`, `DMP_14`, `DMN_14` |

Conditions are `<column> <op> <column|number>` with `> < >= <= ==`,
combined with `AND` / `OR` (AND binds tighter). Raw `open/high/low/close`
are always available. The evaluator is a fixed parser — never `eval()`.

## Development

```bash
uv run pytest                    # backend tests
uv run uvicorn main:app --reload # hot-reload API

cd ui
npm install
npm run dev                      # Vite dev server (proxies to :8000)
npm run build                    # emits ../frontend (served by FastAPI)
```

The integration test hits live Alpaca data and is opt-in:
`DORQ_RUN_INTEGRATION=1 ALPACA_API_KEY=... ALPACA_SECRET_KEY=... uv run pytest tests/test_backtest.py`.

### Layout

```
main.py               FastAPI app, lifespan, SPA serving
config.py             pydantic-settings (DORQ_* env)
api/routes/           papers, strategies, backtest, chat
core/document/        docling parsing + section extraction
core/llm/             Ollama client, prompts, spec/code generation
core/backtest/        Alpaca data, engine, sandboxed executor, analytics
core/models/          StrategySpec, BacktestResult, ParsedPaper
ui/                   React + TypeScript SPA (built into frontend/)
tests/
```

Design constraints (non-negotiable): no LLM-generated code executes outside
the AST-validated sandbox; credentials come from the server env only; state
is in-memory (bounded LRU stores) for the MVP; all blocking work runs in
thread pools, never on the event loop.

## Deployment

Single server with systemd:

```ini
[Unit]
Description=dorq backtesting API
After=network.target

[Service]
User=dorq
WorkingDirectory=/opt/dorq
EnvironmentFile=/opt/dorq/.env
ExecStart=/opt/dorq/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Behind nginx, set `client_max_body_size 55M` (PDF uploads up to 50 MB) and
`proxy_read_timeout 660s` (docling parses and local-model generation can
both run for minutes on CPU-only machines).
