from contextlib import asynccontextmanager

import litellm
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import backtest, papers, strategies
from config import settings
from core.stores import LRUStore

# Prevent litellm from logging API keys or sending usage telemetry
litellm.telemetry = False
litellm.suppress_debug_info = True


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up docling weights before the first request
    from core.document.parser import warmup
    import asyncio
    await asyncio.get_running_loop().run_in_executor(None, warmup)

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
