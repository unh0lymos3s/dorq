import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import litellm
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api.routes import backtest, papers, strategies
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    log = logging.getLogger("dorq.startup")
    log.info("startup.docling_warmup")
    import asyncio
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


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


_FRONTEND = Path(__file__).parent / "frontend"
app.mount("/static", StaticFiles(directory=_FRONTEND), name="static")


@app.get("/")
async def index():
    return FileResponse(_FRONTEND / "index.html")
