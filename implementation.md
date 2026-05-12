# dorq — Implementation Plan

## Phases

1. [Project Scaffold](#phase-1-project-scaffold)
2. [Document Parsing](#phase-2-document-parsing)
3. [LLM Layer](#phase-3-llm-layer)
4. [Backtest Engine](#phase-4-backtest-engine)
5. [API Layer](#phase-5-api-layer)
6. [Tests](#phase-6-tests)

---

## Phase 1 — Project Scaffold

**Goal:** Runnable FastAPI app with config, models, and dependency wiring in place before any feature code.

### Steps

1. **Init repo layout**
   ```
   dorq/
   ├── main.py
   ├── config.py
   ├── requirements.txt
   ├── api/routes/
   ├── core/document/
   ├── core/llm/
   ├── core/backtest/
   ├── core/models/
   └── tests/
   ```

2. **`config.py`** — `pydantic-settings` `Settings` class
   - `app_name`, `debug`, `log_level`
   - No API keys stored server-side; all passed per-request

3. **`core/models/`** — define all data contracts first so every layer has a shared language

   **`paper.py`**
   ```python
   class PaperRecord(BaseModel):
       paper_id: str          # uuid4
       filename: str | None
       source_url: str | None
       uploaded_at: datetime

   class ParsedPaper(BaseModel):
       paper_id: str
       full_markdown: str
       sections: dict[str, str]   # {"abstract": ..., "methodology": ...}
   ```

   **`strategy.py`**
   ```python
   class IndicatorDef(BaseModel):
       name: str              # "SMA" | "RSI" | "MACD" | "BB" | "ATR"
       params: dict[str, Any] # {"period": 20} or {"fast": 12, "slow": 26}

   class RiskParams(BaseModel):
       stop_loss_pct: float | None
       take_profit_pct: float | None

   class StrategySpec(BaseModel):
       title: str
       summary: str
       assets: list[str]
       timeframe: str                  # "1D" | "1W" | "1M"
       date_range: tuple[str, str]     # ISO dates
       indicators: list[IndicatorDef]
       entry_conditions: list[str]
       exit_conditions: list[str]
       position_sizing: str            # "equal_weight" | "fixed" | "percent_equity"
       risk_params: RiskParams
   ```

   **`backtest.py`**
   ```python
   class BacktestRequest(BaseModel):
       strategy_spec: StrategySpec
       alpaca_api_key: str
       alpaca_secret_key: str

   class BacktestResult(BaseModel):
       backtest_id: str
       metrics: dict[str, float]
       charts: list[str]              # base64-encoded PNG strings
   ```

4. **`main.py`** — lifespan, CORS, router stubs (routers return 501 until implemented), `/healthz` endpoint

5. **`requirements.txt`** — pin all deps:
   ```
   fastapi
   uvicorn[standard]
   python-multipart
   aiofiles
   pydantic>=2
   pydantic-settings
   httpx
   docling
   litellm
   alpaca-py
   pandas
   numpy
   pandas_ta
   vectorbt
   plotly
   kaleido
   pytest
   pytest-asyncio
   httpx   # also used in tests via AsyncClient
   ```

**Exit criteria:** `uvicorn main:app` starts; `GET /healthz` returns `{"status": "ok"}`.

---

## Phase 2 — Document Parsing

**Goal:** PDF bytes or URL → `ParsedPaper` with full markdown and keyed sections.

### Steps

1. **`core/document/parser.py`**
   - `async def parse_pdf(pdf_bytes: bytes) -> str` — write bytes to a `tempfile.NamedTemporaryFile`, call `DocumentConverter().convert(path)`, return `result.document.export_to_markdown()`
   - `async def parse_url(url: str) -> str` — pass URL directly to `DocumentConverter` (docling supports URL input)
   - Both run via `asyncio.run_in_executor(None, ...)` so they don't block the event loop
   - Raise `ValueError("docling_parse_error: <detail>")` on failure

2. **`core/document/extractor.py`**
   - `def extract_sections(markdown: str) -> dict[str, str]`
   - Target sections (case-insensitive heading match): `abstract`, `introduction`, `methodology`, `results`, `findings`, `conclusion`
   - Strategy: split markdown on `##` headings; assign content to the first matching section name
   - Always return all keys; missing sections get `""`
   - Keep only the first 4 000 tokens of each section to bound LLM context

3. **In-memory paper store** — `dict[str, ParsedPaper]` on the app state object (sufficient for MVP; no DB)

**Exit criteria:** Feed a PDF bytes fixture → `ParsedPaper.sections["abstract"]` is non-empty.

---

## Phase 3 — LLM Layer

**Goal:** `ParsedPaper` → validated `StrategySpec` via LiteLLM, provider-agnostic.

### Steps

1. **`core/llm/prompts.py`**

   System prompt (key instructions):
   - Role: quant research analyst
   - Task: read paper sections, identify the core tradeable hypothesis
   - Output **only** a JSON object matching `StrategySpec` — no prose, no markdown fences
   - If the paper cannot be mapped to a quantifiable strategy, output `{"error": "<reason>"}`
   - List of supported indicator names and their param keys (constrains LLM output)

   User prompt template:
   ```
   ABSTRACT:
   {abstract}

   METHODOLOGY:
   {methodology}

   RESULTS:
   {results}
   ```

2. **`core/llm/client.py`**
   - `def build_litellm_kwargs(provider: str, model: str, api_key: str) -> dict`
     - Maps e.g. `("openai", "gpt-4o", key)` → `{"model": "openai/gpt-4o", "api_key": key}`
     - Adds `response_format={"type": "json_object"}` for providers that support it (openai, groq)
   - `async def complete(messages, **kwargs) -> str` — thin async wrapper around `litellm.acompletion`; returns `response.choices[0].message.content`

3. **`core/llm/strategy_gen.py`**
   - `async def generate_strategy(parsed_paper: ParsedPaper, provider: str, model: str, api_key: str) -> StrategySpec`
   - Build messages from `prompts.py`, call `client.complete()`
   - Parse JSON: `json.loads(content)`; if `"error"` key present, raise `ValueError(content["error"])`
   - Validate with `StrategySpec(**data)` — Pydantic raises on schema mismatch
   - On `json.JSONDecodeError` or `ValidationError`: retry once with a stricter prompt that prepends "Your previous response was not valid JSON. Output only the JSON object."
   - If second attempt also fails: raise `ValueError("llm_invalid_json")`

**Exit criteria:** With a mocked `litellm.acompletion` returning a valid JSON string, `generate_strategy()` returns a `StrategySpec` with correct fields.

---

## Phase 4 — Backtest Engine

**Goal:** `StrategySpec` + Alpaca credentials → metrics dict + base64 chart list.

### Steps

1. **`core/backtest/data.py`**
   - `async def fetch_bars(assets: list[str], start: str, end: str, timeframe: str, api_key: str, secret_key: str) -> dict[str, pd.DataFrame]`
   - Map `timeframe` → `alpaca_trade_api.TimeFrame`: `"1D"→TimeFrame.Day`, `"1W"→TimeFrame.Week`
   - Use `StockHistoricalDataClient(api_key, secret_key)`
   - Call `.get_stock_bars(StockBarsRequest(symbol_or_symbols=assets, timeframe=..., start=..., end=...))` 
   - `.df` returns multi-index DataFrame; split by symbol into `{symbol: df}` with columns `open, high, low, close, volume`
   - Run in executor (blocking SDK call)
   - Raise `ValueError(f"alpaca_fetch_error: {asset} — {detail}")` if any asset returns empty

2. **`core/backtest/engine.py`**

   `async def run_backtest(spec: StrategySpec, bars: dict[str, pd.DataFrame]) -> vbt.Portfolio`

   For each asset:
   - Compute indicators via `pandas_ta`:
     - `SMA` → `df.ta.sma(length=params["period"])`
     - `RSI` → `df.ta.rsi(length=params["period"])`
     - `MACD` → `df.ta.macd(fast=params["fast"], slow=params["slow"], signal=params["signal"])`
     - `BB` → `df.ta.bbands(length=params["period"])`
     - `ATR` → `df.ta.atr(length=params["period"])`
   - Translate `entry_conditions` / `exit_conditions` to boolean Series using a condition evaluator (see below)
   - Call `vbt.Portfolio.from_signals(close, entries, exits, ...)`

   **Condition evaluator** (`_eval_condition(condition: str, signals: dict) -> pd.Series`):
   - `signals` maps indicator column names to their Series
   - Parse structured condition strings the LLM must output per the prompt spec:
     - `"SMA_20 > SMA_50"` → crossover: `signals["SMA_20"] > signals["SMA_50"]`
     - `"RSI_14 < 30"` → `signals["RSI_14"] < 30`
     - `"close > SMA_200"` → `close > signals["SMA_200"]`
   - Conditions joined with `AND` produce the final entry/exit Series via `&`
   - Keep this evaluator intentionally narrow — only the operators (`>`, `<`, `>=`, `<=`, `==`) and the `AND` conjunction are supported; reject anything else

   **Position sizing:**
   - `equal_weight` → `size = 1 / len(assets)`
   - `fixed` → `size = 1.0`
   - `percent_equity` → use `vbt.Portfolio` `size_type="percent"`, `size=0.95`

   **Risk params:** pass `sl_stop=stop_loss_pct/100`, `tp_stop=take_profit_pct/100` if set.

   Run `vbt.Portfolio.from_signals` inside executor.

3. **`core/backtest/metrics.py`**
   - `def extract_metrics(portfolio: vbt.Portfolio) -> dict[str, float]`
   - Extract: `total_return`, `sharpe_ratio`, `max_drawdown`, `sortino_ratio`, `win_rate`, `num_trades`, `annualized_return`
   - All values rounded to 4 decimal places; missing stats → `None`

4. **`core/backtest/metrics.py`** (charts)
   - `def render_charts(portfolio: vbt.Portfolio) -> list[str]`
   - `fig = portfolio.plot()` → `plotly.io.to_image(fig, format="png")` → `base64.b64encode(...).decode()`
   - Return a list (one chart per asset if multi-asset, one combined otherwise)

**Exit criteria:** Hardcoded `StrategySpec` (SPY, SMA 50/200 crossover, 2015-01-01 to 2023-12-31) → `metrics["total_return"]` is a non-zero float; charts list has ≥1 non-empty string.

---

## Phase 5 — API Layer

**Goal:** Wire parsing, LLM, and backtest into HTTP endpoints; proper error mapping.

### Steps

1. **`api/routes/papers.py`**

   `POST /papers/upload` — `multipart/form-data`, field `file`
   ```
   1. Read file bytes
   2. parser.parse_pdf(bytes)  →  full_markdown
   3. extractor.extract_sections(full_markdown)  →  sections
   4. Build ParsedPaper, store in app.state.papers[paper_id]
   5. Return {"paper_id": ..., "sections_found": list(sections.keys()), "markdown_length": ...}
   ```

   `POST /papers/url` — `{"url": str}`
   ```
   1. httpx.AsyncClient().get(url, follow_redirects=True, timeout=30)  →  pdf_bytes
      (or pass URL directly to docling if it's not a raw PDF redirect)
   2. Same pipeline as upload
   ```

   Error mapping:
   - `ValueError("docling_parse_error: ...")` → `HTTPException(422, detail=...)`

2. **`api/routes/strategies.py`**

   `POST /strategies/generate`
   ```json
   {"paper_id": "...", "provider": "openai", "model": "gpt-4o", "api_key": "sk-..."}
   ```
   ```
   1. Look up ParsedPaper from app.state.papers; 404 if missing
   2. strategy_gen.generate_strategy(paper, provider, model, api_key)
   3. Return StrategySpec as JSON
   ```

   Error mapping:
   - `ValueError("llm_invalid_json")` → 422 `{"detail": "LLM failed to produce valid JSON after retry"}`
   - `ValueError(<llm error reason>)` → 422 `{"detail": reason}`
   - `ValidationError` → 422 with field errors

3. **`api/routes/backtest.py`**

   `POST /backtest/run`
   ```json
   {
     "strategy_spec": {...},
     "alpaca_api_key": "...",
     "alpaca_secret_key": "..."
   }
   ```
   ```
   1. data.fetch_bars(spec.assets, *spec.date_range, spec.timeframe, keys)
   2. engine.run_backtest(spec, bars)  →  portfolio
   3. metrics.extract_metrics(portfolio)
   4. metrics.render_charts(portfolio)
   5. Build BacktestResult, store in app.state.backtests[backtest_id]
   6. Return BacktestResult
   ```

   `GET /backtest/{backtest_id}` — return stored result or 404

   Error mapping:
   - `ValueError("alpaca_fetch_error: ...")` → 422
   - `Exception` from vectorbt → 500 `{"detail": "backtest_runtime_error"}` (no stack trace)

4. **Register routers in `main.py`** with prefix `/` and appropriate tags

**Exit criteria:** Full `curl` round-trip from PDF upload through `/backtest/run` returns a `BacktestResult` with numeric metrics and a non-empty `charts` list.

---

## Phase 6 — Tests

### `tests/test_parser.py`
- Fixture: small real PDF bytes (embed a 2-page stub)
- Assert `full_markdown` non-empty
- Assert at least one of `abstract`, `methodology`, `results` sections non-empty
- Test URL path with `httpx` mock returning PDF bytes

### `tests/test_strategy_gen.py`
- Mock `litellm.acompletion` to return a valid `StrategySpec` JSON string
- Assert returned object is a `StrategySpec` with correct field values
- Mock returning `{"error": "cannot map to strategy"}` → assert `ValueError` raised
- Mock returning invalid JSON on first call, valid JSON on second → assert retry works
- Mock returning invalid JSON on both calls → assert `ValueError("llm_invalid_json")`

### `tests/test_backtest.py`
- Use a hardcoded `StrategySpec`:
  ```python
  spec = StrategySpec(
      title="SMA Crossover Test",
      summary="Buy when 50-day SMA crosses above 200-day SMA.",
      assets=["SPY"],
      timeframe="1D",
      date_range=("2015-01-01", "2023-12-31"),
      indicators=[
          IndicatorDef(name="SMA", params={"period": 50}),
          IndicatorDef(name="SMA", params={"period": 200}),
      ],
      entry_conditions=["SMA_50 > SMA_200"],
      exit_conditions=["SMA_50 < SMA_200"],
      position_sizing="equal_weight",
      risk_params=RiskParams(stop_loss_pct=None, take_profit_pct=None),
  )
  ```
- Requires live Alpaca paper-trading credentials in env (`ALPACA_API_KEY`, `ALPACA_SECRET_KEY`); skip with `pytest.mark.skipif` if absent
- Assert `metrics["total_return"]` is a `float`
- Assert `len(charts) >= 1` and `charts[0]` is a non-empty string

---

## Implementation Order

| # | Task | Depends on |
|---|------|-----------|
| 1 | Scaffold + models | — |
| 2 | `parser.py` + `extractor.py` | 1 |
| 3 | LLM `prompts.py` + `client.py` + `strategy_gen.py` | 1 |
| 4 | Backtest `data.py` + `engine.py` + `metrics.py` | 1 |
| 5 | API routes + error mapping | 2, 3, 4 |
| 6 | Tests | 2, 3, 4, 5 |

Phases 2, 3, 4 are independent and can be built in parallel.

---

## Design Constraints (non-negotiable)

- **No LLM-generated code execution.** The condition evaluator is a fixed parser, not `eval()`.
- **No server-side key storage.** API keys are request-scoped only.
- **No database.** In-memory dicts on `app.state` for MVP.
- **Async throughout.** All blocking calls (docling, Alpaca SDK, vectorbt) run in a thread pool via `run_in_executor`.
- **JSON-only errors.** All `HTTPException` details are plain strings — no raw stack traces in responses.
