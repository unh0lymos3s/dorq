import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import litellm
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from api.routes import backtest, papers, strategies
from api.routes import chat as chat_routes
from config import settings
from core.stores import LRUStore

_LOG_LEVEL = settings.log_level.upper()

logging.basicConfig(
    level=_LOG_LEVEL,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    force=True,  # override uvicorn's pre-installed root handler
)
for _name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
    _lg = logging.getLogger(_name)
    _lg.handlers.clear()
    _lg.propagate = True

litellm.telemetry = False
litellm.suppress_debug_info = settings.log_level != "debug"


_FRONTEND = Path(__file__).parent / "frontend"
_INDEX_PATH = _FRONTEND / "index.html"
# Snapshot at import time so the SPA fallback never re-stats the filesystem.
_INDEX_EXISTS = _INDEX_PATH.is_file()
_NO_FRONTEND_RESPONSE = JSONResponse({"status": "frontend not built"})


@asynccontextmanager
async def lifespan(app: FastAPI):
    log = logging.getLogger("dorq.startup")
    log.info("startup.docling_warmup")
    from core.document.parser import warmup
    t0 = time.perf_counter()
    await asyncio.get_running_loop().run_in_executor(None, warmup)
    log.info("startup.docling_ready elapsed_ms=%d", int((time.perf_counter() - t0) * 1000))

    app.state.papers = LRUStore(maxsize=128)
    app.state.strategies = LRUStore(maxsize=128)
    app.state.backtests = LRUStore(maxsize=128)
    yield


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(papers.router)
app.include_router(strategies.router)
app.include_router(backtest.router)
app.include_router(chat_routes.router)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Global catch-all: never leak raw stack traces to clients."""
    _log = logging.getLogger("dorq.exceptions")
    _log.error("unhandled_exception path=%s", request.url.path, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "detail": "An unexpected error occurred"},
    )


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/config")
async def client_config():
    """Public, non-secret runtime config the UI reads on load."""
    return {
        "ollama_model": settings.ollama_model,
        "alpaca_configured": settings.alpaca_configured,
    }


# Mount /assets for Vite's hashed JS/CSS bundles (must come before the catch-all).
# Vite emits content-hashed filenames, so we can cache aggressively.
if (_FRONTEND / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=_FRONTEND / "assets"), name="assets")


# SPA fallback: serve index.html for all unmatched routes (client-side routing).
# index.html must NOT be cached aggressively (it references hashed assets),
# but FileResponse will set ETag/Last-Modified so 304s short-circuit re-downloads.
@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str) -> Response:
    if _INDEX_EXISTS:
        return FileResponse(_INDEX_PATH)
    return _NO_FRONTEND_RESPONSE
