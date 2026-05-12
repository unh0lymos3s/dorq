# dorq — Research-to-Strategy Backtesting Platform

## Context
dorq automates the path from a macro trading research paper to a tested trading strategy. A user uploads a PDF or pastes a URL; docling parses it; an LLM extracts the tradeable thesis and generates a strategy spec; vectorbt runs the backtest against Alpaca market data; results (metrics + charts) are returned over the API.

Backend-only MVP. No frontend. LLM provider is hotswappable via request parameters + API key.

---

## Architecture Overview

```
PDF / URL
   │
   ▼
[IBM Docling]  ──►  Markdown (abstract + findings + methodology)
   │
   ▼
[LiteLLM]      ──►  Structured Strategy Spec (JSON)
(OpenAI / Anthropic / Gemini / Groq / Ollama)
   │
   ▼
[Strategy Builder]  ──►  vectorbt-compatible entry/exit signals
   │
   ▼
[Alpaca Markets API]  ──►  OHLCV data for requested asset + date range
   │
   ▼
[vectorbt Engine]   ──►  Portfolio, metrics, Plotly charts
   │
   ▼
[FastAPI Response]  ──►  JSON: metrics + base64 chart images
```

---

## Project Structure

```
dorq/
├── main.py                       # FastAPI app, lifespan, router registration
├── config.py                     # Pydantic Settings — env vars, defaults
├── requirements.txt
│
├── api/
│   └── routes/
│       ├── papers.py             # POST /papers/upload, POST /papers/url
│       ├── strategies.py         # POST /strategies/generate
│       └── backtest.py           # POST /backtest/run, GET /backtest/{id}
│
├── core/
│   ├── document/
│   │   ├── parser.py             # IBM docling: PDF bytes → Markdown
│   │   └── extractor.py          # Section extraction (abstract, findings)
│   ├── llm/
│   │   ├── client.py             # LiteLLM wrapper, provider/key injection
│   │   ├── prompts.py            # System + user prompt templates
│   │   └── strategy_gen.py       # Paper markdown → StrategySpec JSON
│   ├── backtest/
│   │   ├── data.py               # Alpaca historical bars fetch
│   │   ├── engine.py             # vectorbt runner: StrategySpec → Portfolio
│   │   └── metrics.py            # Extract stats dict from vbt Portfolio
│   └── models/
│       ├── paper.py              # PaperRecord, ParsedPaper
│       ├── strategy.py           # StrategySpec (the central data contract)
│       └── backtest.py           # BacktestRequest, BacktestResult
│
└── tests/
    ├── test_parser.py
    ├── test_strategy_gen.py
    └── test_backtest.py
```

---

## Central Data Contract: `StrategySpec`

```python
class StrategySpec(BaseModel):
    title: str
    summary: str                  # 2-3 sentence thesis from the paper
    assets: list[str]             # e.g. ["SPY", "TLT", "GLD"]
    timeframe: str                # "1D", "1W", "1M"
    date_range: tuple[str, str]   # ("2010-01-01", "2024-12-31")
    indicators: list[IndicatorDef]  # SMA, RSI, MACD, etc. with params
    entry_conditions: list[str]   # human-readable signal descriptions
    exit_conditions: list[str]
    position_sizing: str          # "equal_weight" | "fixed" | "percent_equity"
    risk_params: RiskParams       # stop_loss_pct, take_profit_pct
```

The LLM populates this spec. The backtest engine consumes it deterministically. No LLM-generated code is executed — this keeps the system safe and predictable.

---

## Key Components

### 1. Document Parsing (`core/document/parser.py`)
- Use `docling.DocumentConverter` to convert PDF bytes or URL to Markdown
- `extractor.py` uses heuristics + regex to pull: Abstract, Introduction, Methodology, Results/Findings sections
- Output: `ParsedPaper` with full markdown + extracted sections dict

### 2. LLM Layer (`core/llm/`)
- **LiteLLM** provides a single `completion()` call that works across all providers
- Provider + model + API key passed per-request (no server-side key storage)
- `prompts.py` has a structured prompt that instructs the LLM to output a `StrategySpec` as JSON (with `response_format={"type": "json_object"}` where supported)
- Fallback: if provider doesn't support JSON mode, parse JSON from the text response
- Supported model strings: `openai/gpt-4o`, `anthropic/claude-sonnet-4-6`, `gemini/gemini-2.5-pro`, `groq/llama-3.1-70b-versatile`, `ollama/llama3`

### 3. Backtest Engine (`core/backtest/`)
- `data.py`: Use `alpaca-py` `StockHistoricalDataClient` to fetch daily bars for each asset in the spec
- `engine.py`: Translate `StrategySpec` indicators into pandas Series (using `pandas_ta`), then use `vectorbt.Portfolio.from_signals()` to run the backtest
- `metrics.py`: Extract from `vbt.Portfolio`: total_return, sharpe_ratio, max_drawdown, win_rate, num_trades, sortino_ratio
- Charts: call `portfolio.plot()` (returns Plotly fig) → serialize to base64 PNG via `plotly.io.to_image`

### 4. API Layer (`api/routes/`)
**POST /papers/upload** — multipart PDF upload → returns `paper_id` + parsed markdown  
**POST /papers/url** — `{url: str}` → fetches PDF, same pipeline  
**POST /strategies/generate** — `{paper_id, provider, model, api_key}` → returns `StrategySpec`  
**POST /backtest/run** — `{strategy_spec, alpaca_api_key, alpaca_secret_key}` → returns metrics + charts  

All heavy work is async; docling and backtest run in a thread pool via `asyncio.run_in_executor`.

---

## Dependencies

```
fastapi
uvicorn[standard]
python-multipart          # file uploads
aiofiles
pydantic-settings
httpx                     # URL fetching

docling                   # IBM PDF parsing

litellm                   # unified LLM provider interface

alpaca-py                 # Alpaca market data
pandas
numpy
pandas_ta                 # technical indicators
vectorbt                  # backtesting engine
plotly
kaleido                   # Plotly static image export
```

---

## LLM Prompt Strategy

The system prompt instructs the LLM to:
1. Read the research paper sections provided
2. Identify the core hypothesis and tradeable signal
3. Output **only** a valid JSON object conforming to `StrategySpec`
4. If the paper cannot be mapped to a quantifiable strategy, output `{"error": "<reason>"}`

The user prompt wraps the extracted paper sections with clear delimiters.

---

## Error Handling

- Docling parse failure → 422 with `parsing_error` detail
- LLM returns invalid/unparseable JSON → retry once with stricter prompt; else 422
- LLM returns `{"error": ...}` → 422 with the LLM's reason forwarded to the caller
- Alpaca data fetch failure (bad ticker, no history) → 422 with asset + date range detail
- vectorbt runtime error → 500 with sanitized error (no stack trace in prod)

---

## Verification / Test Plan

1. **Unit**: `test_parser.py` — feed a known PDF, assert sections extracted correctly
2. **Unit**: `test_strategy_gen.py` — mock LiteLLM response, assert `StrategySpec` parsed correctly
3. **Integration**: `test_backtest.py` — run a hardcoded `StrategySpec` (SPY SMA crossover), fetch Alpaca data, assert `total_return` is a float and chart is non-empty base64
4. **E2E (manual)**: `curl -F file=@paper.pdf http://localhost:8000/papers/upload` through the full pipeline using a real paper (e.g. the Faber tactical asset allocation paper)
