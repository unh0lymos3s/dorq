# dorq

Research-to-strategy backtesting platform. Upload a macro trading research paper (PDF or URL), and dorq extracts a tradeable strategy spec via LLM, runs it against historical market data from Alpaca, and returns backtest metrics and charts.

```
PDF / URL → [docling] → Markdown → [LiteLLM] → StrategySpec → [vectorbt + Alpaca] → metrics + charts
```

---

## Installation

### Prerequisites

- Python 3.12 (not 3.13+; required by vectorbt/llvmlite)
- [uv](https://docs.astral.sh/uv/) — install with `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Docker + Docker Compose (optional, for local infrastructure)

### 1. Clone and install

```bash
git clone https://github.com/unh0lymos3s/dorq.git
cd dorq
uv sync --dev
```

### 2. Configure environment (optional)

```bash
cp .env.example .env
```

LLM API keys and Alpaca credentials are passed per-request — not stored in config. The only setting you may want to change is `DORQ_LOG_LEVEL` (default: `info`).

### 3. Run the server

```bash
cd dorq
uv run uvicorn main:app --host 0.0.0.0 --port 8000
```

The API and frontend are available at **http://localhost:8000**.

---

## Development

```bash
# Run all tests
uv run pytest

# Run a single test file
uv run pytest tests/test_parser.py -v

# Integration test (requires Alpaca credentials)
ALPACA_API_KEY=... ALPACA_SECRET_KEY=... uv run pytest tests/test_backtest.py -v

# Hot-reload dev server
uv run uvicorn main:app --reload
```

---

## Deployment

### Single-server (systemd)

Create `/etc/systemd/system/dorq.service`:

```ini
[Unit]
Description=dorq backtesting API
After=network.target

[Service]
User=samosa
WorkingDirectory=/home/samosa/dorq
EnvironmentFile=/home/samosa/dorq/.env
ExecStart=/home/samosa/dorq/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dorq
sudo systemctl status dorq
```

### Behind a reverse proxy (nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 55M;  # allow up to 50 MB PDF uploads

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;  # docling can take up to 2 min
    }
}
```

### Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DORQ_DEBUG` | `false` | Enable FastAPI debug mode |
| `DORQ_LOG_LEVEL` | `info` | Log verbosity (`debug`\|`info`\|`warning`\|`error`\|`critical`) |
| `DORQ_CORS_ORIGINS` | `["*"]` | Allowed CORS origins (JSON array) |

---

## Frontend UI

The frontend is a single-page application served at `GET /` from `frontend/index.html`. It is plain HTML + CSS + vanilla JavaScript — no build step, no framework. It talks directly to the FastAPI backend on the same origin.

### Architecture

`frontend/index.html` is a self-contained file mounted via FastAPI's `StaticFiles` at `/static` and served as the index at `/`. The JavaScript makes `fetch()` calls to the API using relative paths (same origin), so no CORS configuration is needed for the UI itself.

```
main.py
  app.mount("/static", StaticFiles(directory="frontend"))
  app.get("/")  →  FileResponse("frontend/index.html")
```

### Pipeline wizard

The UI is a 4-step linear wizard. Each step activates only after the previous one completes successfully. Steps are visually distinct — pending (grey), active (blue border + highlighted number), done (green border + checkmark badge).

#### Step 1 — Upload Paper

- Two input modes toggled by a tab row: **PDF File** and **URL**.
- PDF mode: drag-and-drop zone (handles `dragover`, `dragleave`, `drop` events) or click-to-browse via a hidden `<input type="file">`. The selected filename and size are shown beneath the zone.
- URL mode: a plain text input for an `https://` URL.
- On submit, calls `POST /papers/upload` (multipart form data) or `POST /papers/url` (JSON body `{ url }`).
- On success, displays the returned `paper_id`, the list of sections found, and the markdown character count. Stores `paper_id` in the `state` object for Step 2.

#### Step 2 — Generate Strategy

- Provider dropdown: OpenAI, Anthropic, Groq, Gemini, Azure, Bedrock, Ollama.
- Model text input (e.g. `gpt-4o`, `claude-sonnet-4-6`).
- Password input for the LLM API key (not stored anywhere after the request completes).
- Calls `POST /strategies/generate` with `{ paper_id, provider, model, api_key }`.
- On success, stores the full `StrategySpec` JSON in `state.strategySpec` and renders a collapsible `<details>` preview showing: title, assets, timeframe, date range, position sizing, risk params, entry/exit conditions, and indicator definitions.

#### Step 3 — Run Backtest

- Two password inputs for the Alpaca API key and secret key.
- Calls `POST /backtest/run` with `{ strategy_spec, alpaca_api_key, alpaca_secret_key }`. The full `StrategySpec` from Step 2 is sent as-is.
- A spinner replaces the button label during the request (which can take 10–30 seconds while Alpaca data is fetched and vectorbt runs).
- On success, triggers Step 4 rendering and scrolls it into view.

#### Step 4 — Results

Rendered automatically when the backtest completes. Not shown until then.

**Metrics grid**: a responsive CSS grid of metric cards. Each card shows a label and a value. Values are formatted as follows:

| Metric | Format | Colour |
|--------|--------|--------|
| `total_return` | percentage, 2 dp | green if ≥ 0, red if < 0 |
| `annualized_return` | percentage, 2 dp | green / red |
| `sharpe_ratio` | 3 dp | green / red |
| `max_drawdown` | percentage, 2 dp | green / red |
| `win_rate` | percentage, 1 dp | always green |
| `total_trades` | integer | neutral |
| `calmar_ratio` | 3 dp | green / red |
| `volatility` | percentage, 2 dp | neutral |

`null` metrics are skipped. Unknown numeric metrics fall back to 4 dp with no colour.

**Charts**: each base64 PNG in `result.charts` is rendered as a full-width `<img>` with `src="data:image/png;base64,..."`.

### State management

A single plain object `state` holds the in-flight data across steps:

```js
{
  tab: 'file' | 'url',
  file: File | null,         // selected PDF
  paperId: string | null,    // from Step 1 response
  strategySpec: object | null, // StrategySpec from Step 2 response
}
```

### Error handling

Every step has a dedicated error `<div>` that is shown/hidden by `showError(id, msg)`. Errors surface the `detail` field from the FastAPI JSON error response, or fall back to `HTTP <status>`. Network failures surface the exception message. Errors are cleared at the start of each submit.

### Loading states

`setLoading(btnId, loading, label)` disables the submit button and injects a CSS-animated spinner (`border-top-color` rotating via `@keyframes spin`) next to the label text while a request is in flight.

### Styling

All styles are inline in a `<style>` block. Key design tokens (CSS custom properties):

| Variable | Value | Purpose |
|----------|-------|---------|
| `--bg` | `#0f1117` | Page background |
| `--surface` | `#1a1d27` | Card / step background |
| `--border` | `#2a2d3a` | Default border colour |
| `--accent` | `#6c8cff` | Active step highlight, buttons |
| `--success` | `#4caf82` | Done state, positive metrics |
| `--error` | `#e05a5a` | Error messages, negative metrics |
| `--muted` | `#6b7098` | Labels and secondary text |

No external CSS libraries or fonts are loaded. The layout uses flexbox for the step column and CSS Grid (`repeat(auto-fill, minmax(160px, 1fr))`) for the metrics cards.

---

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Frontend UI |
| `GET` | `/healthz` | Health check |
| `POST` | `/papers/upload` | Upload a PDF (multipart `file` field) |
| `POST` | `/papers/url` | Parse a paper from a URL (`{ url }`) |
| `POST` | `/strategies/generate` | Extract a `StrategySpec` via LLM |
| `POST` | `/backtest/run` | Fetch Alpaca data and run vectorbt backtest |
| `GET` | `/backtest/{id}` | Retrieve a stored backtest result |

All API responses and errors are JSON. Error details are plain strings — no stack traces.

---

## Stack

| Layer | Library |
|-------|---------|
| API | FastAPI + uvicorn |
| Config | pydantic-settings |
| PDF parsing | docling |
| LLM | LiteLLM |
| Market data | alpaca-py |
| Backtesting | vectorbt + pandas-ta |
| Charts | Plotly + kaleido |
| Logging | Python stdlib `logging` |
| Frontend | Vanilla HTML / CSS / JS (no build step) |

---

## Project structure

```
dorq/
├── main.py                    # FastAPI app, lifespan, router + static mount
├── config.py                  # pydantic-settings Settings
├── frontend/
│   └── index.html             # Single-page frontend UI
├── api/routes/
│   ├── papers.py              # POST /papers/upload, POST /papers/url
│   ├── strategies.py          # POST /strategies/generate
│   └── backtest.py            # POST /backtest/run, GET /backtest/{id}
├── core/
│   ├── document/
│   │   ├── parser.py          # docling: PDF bytes or URL → Markdown
│   │   └── extractor.py       # Heading-based section splitter
│   ├── llm/
│   │   ├── client.py          # LiteLLM async wrapper
│   │   ├── prompts.py         # System + user prompt templates
│   │   └── strategy_gen.py    # ParsedPaper → StrategySpec with retry
│   ├── backtest/
│   │   ├── data.py            # Alpaca → dict[str, DataFrame]
│   │   ├── engine.py          # StrategySpec + bars → vbt.Portfolio
│   │   └── metrics.py         # Portfolio → metrics dict + base64 charts
│   └── models/
│       ├── paper.py           # PaperRecord, ParsedPaper
│       ├── strategy.py        # StrategySpec, IndicatorDef, RiskParams
│       └── backtest.py        # BacktestRequest, BacktestResult
└── tests/
    ├── test_parser.py
    ├── test_strategy_gen.py
    └── test_backtest.py       # Integration test (skipped without Alpaca keys)
```

---

## Design constraints

- **No LLM-generated code execution.** The condition evaluator in `engine.py` is a fixed regex parser — no `eval()` or `exec()`.
- **No server-side key storage.** LLM and Alpaca credentials are request-scoped only.
- **No database.** In-memory LRU dicts on `app.state` (max 128 entries each).
- **Async throughout.** All blocking I/O (docling, Alpaca SDK, vectorbt) runs in `asyncio.run_in_executor`.
