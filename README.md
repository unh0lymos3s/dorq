# dorq

Research-to-strategy backtesting platform. Upload a macro trading research paper (PDF or URL), and dorq extracts a tradeable strategy spec via LLM, runs it against historical market data from Alpaca, and returns backtest metrics and charts.

Backend-only JSON API. No frontend.

---

## Current state (Phase 1 — scaffold)

The project skeleton is in place. The server starts, all data models are defined, and route stubs exist for every endpoint. No business logic is implemented yet — all routes return `501 Not Implemented`.

### What works

- `GET /healthz` → `{"status": "ok"}`
- All Pydantic models (`PaperRecord`, `ParsedPaper`, `StrategySpec`, `BacktestRequest`, `BacktestResult`) are defined and importable
- In-memory stores for papers and backtest results are wired into app state via lifespan

### Planned endpoints (stubbed)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/papers/upload` | Upload a PDF file |
| `POST` | `/papers/url` | Parse a paper from a URL |
| `POST` | `/strategies/generate` | Extract a `StrategySpec` from a parsed paper via LLM |
| `POST` | `/backtest/run` | Run a backtest against Alpaca data |
| `GET`  | `/backtest/{id}` | Retrieve a stored backtest result |

---

## Setup

Requires Python 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
uv sync --dev
uv run uvicorn main:app --reload
```

---

## Stack

| Layer | Library |
|-------|---------|
| API | FastAPI + uvicorn |
| Config | pydantic-settings |
| PDF parsing | docling *(Phase 2)* |
| LLM | LiteLLM *(Phase 3)* |
| Market data | alpaca-py *(Phase 4)* |
| Backtesting | vectorbt + pandas-ta *(Phase 4)* |
| Charts | Plotly + kaleido *(Phase 4)* |
