"""GET /memory/* — persistent recall over previously stored papers and strategies.

Backed by the file-based ``MemoryEngine`` on ``app.state.memory``; entries
survive server restarts, unlike the session LRU stores.
"""
import logging

from fastapi import APIRouter, Query, Request, status

from config import settings
from core.errors import ERR_INTERNAL, ERR_NOT_FOUND, raise_http

router = APIRouter(prefix="/memory", tags=["memory"])
logger = logging.getLogger("dorq." + __name__)


def _engine(request: Request):
    engine = getattr(request.app.state, "memory", None)
    if engine is None:
        raise_http(status.HTTP_503_SERVICE_UNAVAILABLE, ERR_INTERNAL, "memory engine not initialized")
    return engine


@router.get("")
async def memory_status(request: Request) -> dict:
    engine = _engine(request)
    papers = await engine.list_papers()
    strategies = await engine.list_strategies()
    return {
        "papers": len(papers),
        "strategies": len(strategies),
        "semantic_search": settings.embeddings_configured,
        "embed_model": settings.ollama_embed_model or None,
    }


@router.get("/papers")
async def memory_papers(request: Request) -> list[dict]:
    """All persisted papers, most recent first."""
    return await _engine(request).list_papers()


@router.get("/strategies")
async def memory_strategies(request: Request) -> list[dict]:
    """All persisted strategies, most recent first."""
    return await _engine(request).list_strategies()


@router.get("/strategies/{strategy_id}")
async def memory_strategy(request: Request, strategy_id: str) -> dict:
    """Full persisted strategy document (spec or code) so the UI can restore it."""
    doc = await _engine(request).get_strategy(strategy_id)
    if doc is None:
        raise_http(status.HTTP_404_NOT_FOUND, ERR_NOT_FOUND, f"strategy {strategy_id!r} not found")
    doc.pop("embedding", None)  # internal vector, large and useless to clients
    return doc


@router.get("/search")
async def memory_search(
    request: Request,
    q: str = Query(min_length=1, max_length=500),
    k: int = Query(default=5, ge=1, le=25),
) -> list[dict]:
    """Rank stored papers and strategies against a free-text query.

    Semantic (embedding cosine) when DORQ_OLLAMA_EMBED_MODEL is set;
    keyword-overlap fallback otherwise.
    """
    hits = await _engine(request).search(q, k=k)
    logger.info("memory.search q_len=%d hits=%d", len(q), len(hits))
    return hits
