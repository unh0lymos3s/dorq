"""File-backed memory engine: papers and strategies that survive restarts.

The session ``LRUStore``s on ``app.state`` stay the hot path; the memory
engine mirrors every parsed paper and generated strategy to disk as one JSON
document per entry, and (when ``DORQ_OLLAMA_EMBED_MODEL`` is set) attaches an
embedding computed by the local Ollama instance so ``/memory/search`` can do
semantic recall. Without an embed model, search falls back to keyword overlap.

Disk layout under ``settings.memory_dir``::

    papers/{paper_id}.json      record + markdown + sections [+ embedding]
    strategies/{strategy_id}.json  kind, paper_id, spec/code payload [+ embedding]

All file I/O runs in the default thread-pool executor; embeddings are computed
in fire-and-forget background tasks so upload/generate latency is unaffected.
"""

import asyncio
import json
import logging
import math
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx

from core.models.paper import PaperRecord, ParsedPaper
from core.models.strategy import PortfolioConfig, StrategySpec

logger = logging.getLogger("dorq.memory")

_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9._:-]")

# Papers can be long; embed only the head of the document — abstracts and
# introductions carry the semantic signal that matters for recall.
_EMBED_CHARS = 8_000


def _safe_name(entry_id: str) -> str:
    return _SAFE_ID_RE.sub("_", entry_id)[:120]


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _keyword_score(query: str, text: str) -> float:
    """Fallback relevance: fraction of query tokens present in the text."""
    tokens = {t for t in re.findall(r"[a-z0-9]{3,}", query.lower())}
    if not tokens:
        return 0.0
    hay = text.lower()
    return sum(1 for t in tokens if t in hay) / len(tokens)


class MemoryEngine:
    def __init__(
        self,
        root: str | Path,
        *,
        ollama_base_url: str = "http://localhost:11434",
        embed_model: str = "",
        embed_timeout: float = 120.0,
    ) -> None:
        self._root = Path(root)
        self._papers_dir = self._root / "papers"
        self._strategies_dir = self._root / "strategies"
        self._base_url = ollama_base_url.rstrip("/")
        self._embed_model = embed_model
        self._embed_timeout = embed_timeout
        self._lock = asyncio.Lock()
        self._bg_tasks: set[asyncio.Task] = set()
        for d in (self._papers_dir, self._strategies_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ io

    def _path(self, kind: str, entry_id: str) -> Path:
        base = self._papers_dir if kind == "paper" else self._strategies_dir
        return base / f"{_safe_name(entry_id)}.json"

    @staticmethod
    def _write_json(path: Path, doc: dict) -> None:
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    @staticmethod
    def _read_json(path: Path) -> dict | None:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("memory.read_failed path=%s", path, exc_info=True)
            return None

    def _load_all(self, directory: Path) -> list[dict]:
        docs = []
        for p in sorted(directory.glob("*.json")):
            doc = self._read_json(p)
            if doc is not None:
                docs.append(doc)
        docs.sort(key=lambda d: d.get("saved_at", ""))
        return docs

    async def _save(self, kind: str, entry_id: str, doc: dict) -> None:
        path = self._path(kind, entry_id)
        loop = asyncio.get_running_loop()
        async with self._lock:
            await loop.run_in_executor(None, self._write_json, path, doc)

    # ------------------------------------------------------------- embedding

    async def _embed(self, text: str) -> list[float] | None:
        if not self._embed_model or not text.strip():
            return None
        async with httpx.AsyncClient(timeout=self._embed_timeout) as client:
            resp = await client.post(
                f"{self._base_url}/api/embed",
                json={"model": self._embed_model, "input": text[:_EMBED_CHARS]},
            )
            resp.raise_for_status()
            embeddings = resp.json().get("embeddings") or []
        return embeddings[0] if embeddings else None

    def _spawn_embed(self, kind: str, entry_id: str, text: str) -> None:
        """Compute the embedding off the request path and patch it into the
        stored document when ready. Failures only cost semantic search."""
        if not self._embed_model:
            return

        async def _job() -> None:
            try:
                vector = await self._embed(text)
            except Exception:
                logger.warning("memory.embed_failed kind=%s id=%s", kind, entry_id, exc_info=True)
                return
            if vector is None:
                return
            path = self._path(kind, entry_id)
            loop = asyncio.get_running_loop()
            async with self._lock:
                doc = await loop.run_in_executor(None, self._read_json, path)
                if doc is None:
                    return
                doc["embedding"] = vector
                await loop.run_in_executor(None, self._write_json, path, doc)
            logger.info("memory.embedded kind=%s id=%s dims=%d", kind, entry_id, len(vector))

        task = asyncio.create_task(_job())
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    # ---------------------------------------------------------------- writes

    async def add_paper(self, record: PaperRecord, parsed: ParsedPaper) -> None:
        doc = {
            "type": "paper",
            "paper_id": record.paper_id,
            "filename": record.filename,
            "source_url": record.source_url,
            "uploaded_at": record.uploaded_at.isoformat(),
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "full_markdown": parsed.full_markdown,
            "sections": parsed.sections,
            "embedding": None,
        }
        await self._save("paper", record.paper_id, doc)
        self._spawn_embed("paper", record.paper_id, parsed.full_markdown)
        logger.info("memory.paper_saved paper_id=%s md_len=%d",
                    record.paper_id, len(parsed.full_markdown))

    async def add_strategy(
        self,
        strategy_id: str,
        paper_id: str,
        *,
        spec: StrategySpec | None = None,
        strategy_code: str | None = None,
        portfolio_config: dict | None = None,
    ) -> None:
        kind = "spec" if spec is not None else "code"
        doc = {
            "type": "strategy",
            "strategy_id": strategy_id,
            "paper_id": paper_id,
            "kind": kind,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "spec": spec.model_dump(mode="json") if spec is not None else None,
            "strategy_code": strategy_code,
            "portfolio_config": portfolio_config,
            "embedding": None,
        }
        await self._save("strategy", strategy_id, doc)
        if spec is not None:
            embed_text = "\n".join([
                spec.title, spec.summary, " ".join(spec.assets),
                " ".join(spec.entry_conditions), " ".join(spec.exit_conditions),
            ])
        else:
            embed_text = strategy_code or ""
        self._spawn_embed("strategy", strategy_id, embed_text)
        logger.info("memory.strategy_saved strategy_id=%s kind=%s", strategy_id, kind)

    # ----------------------------------------------------------------- reads

    async def list_papers(self) -> list[dict]:
        loop = asyncio.get_running_loop()
        docs = await loop.run_in_executor(None, self._load_all, self._papers_dir)
        return [
            {
                "paper_id": d.get("paper_id"),
                "filename": d.get("filename"),
                "source_url": d.get("source_url"),
                "uploaded_at": d.get("uploaded_at"),
                "saved_at": d.get("saved_at"),
                "markdown_length": len(d.get("full_markdown") or ""),
                "embedded": bool(d.get("embedding")),
            }
            for d in reversed(docs)  # most recent first
        ]

    async def list_strategies(self) -> list[dict]:
        loop = asyncio.get_running_loop()
        docs = await loop.run_in_executor(None, self._load_all, self._strategies_dir)
        out = []
        for d in reversed(docs):
            spec = d.get("spec") or {}
            out.append({
                "strategy_id": d.get("strategy_id"),
                "paper_id": d.get("paper_id"),
                "kind": d.get("kind"),
                "saved_at": d.get("saved_at"),
                "title": spec.get("title"),
                "assets": spec.get("assets") or (d.get("portfolio_config") or {}).get("assets"),
                "timeframe": spec.get("timeframe") or (d.get("portfolio_config") or {}).get("timeframe"),
                "embedded": bool(d.get("embedding")),
            })
        return out

    async def get_paper(self, paper_id: str) -> dict | None:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._read_json, self._path("paper", paper_id))

    async def get_strategy(self, strategy_id: str) -> dict | None:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, self._read_json, self._path("strategy", strategy_id)
        )

    # ---------------------------------------------------------------- search

    @staticmethod
    def _doc_text(doc: dict) -> str:
        if doc.get("type") == "paper":
            return (doc.get("full_markdown") or "")[:_EMBED_CHARS]
        spec = doc.get("spec") or {}
        return " ".join(str(v) for v in [
            spec.get("title", ""), spec.get("summary", ""),
            " ".join(spec.get("assets") or []),
            doc.get("strategy_code") or "",
        ])

    def _summarize_hit(self, doc: dict, score: float) -> dict:
        if doc.get("type") == "paper":
            return {
                "type": "paper",
                "id": doc.get("paper_id"),
                "score": round(score, 4),
                "filename": doc.get("filename"),
                "source_url": doc.get("source_url"),
                "preview": (doc.get("full_markdown") or "")[:280],
            }
        spec = doc.get("spec") or {}
        return {
            "type": "strategy",
            "id": doc.get("strategy_id"),
            "score": round(score, 4),
            "paper_id": doc.get("paper_id"),
            "kind": doc.get("kind"),
            "title": spec.get("title"),
            "summary": spec.get("summary"),
            "assets": spec.get("assets") or (doc.get("portfolio_config") or {}).get("assets"),
        }

    async def search(self, query: str, k: int = 5) -> list[dict]:
        """Rank stored papers and strategies against ``query``.

        Uses cosine similarity over Ollama embeddings when available; entries
        without an embedding (or when no embed model is configured) are scored
        by keyword overlap so search always returns something sensible.
        """
        loop = asyncio.get_running_loop()
        papers = await loop.run_in_executor(None, self._load_all, self._papers_dir)
        strategies = await loop.run_in_executor(None, self._load_all, self._strategies_dir)
        docs = papers + strategies
        if not docs:
            return []

        query_vec: list[float] | None = None
        if self._embed_model:
            try:
                query_vec = await self._embed(query)
            except Exception:
                logger.warning("memory.search_embed_failed", exc_info=True)

        scored: list[tuple[float, dict]] = []
        for doc in docs:
            vec = doc.get("embedding")
            if query_vec is not None and vec:
                score = _cosine(query_vec, vec)
            else:
                score = _keyword_score(query, self._doc_text(doc))
            if score > 0:
                scored.append((score, doc))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [self._summarize_hit(doc, score) for score, doc in scored[:k]]

    # --------------------------------------------------------------- startup

    async def reload_into(self, papers_store, strategies_store) -> tuple[int, int]:
        """Rehydrate the session LRU stores from disk so paper/strategy IDs
        from previous runs keep working after a server restart."""
        loop = asyncio.get_running_loop()
        paper_docs = await loop.run_in_executor(None, self._load_all, self._papers_dir)
        strategy_docs = await loop.run_in_executor(None, self._load_all, self._strategies_dir)

        n_papers = 0
        for d in paper_docs:  # oldest first → most recent ends up freshest in LRU
            paper_id = d.get("paper_id")
            if not paper_id or not isinstance(d.get("full_markdown"), str):
                continue
            record = PaperRecord(
                paper_id=paper_id,
                filename=d.get("filename"),
                source_url=d.get("source_url"),
            )
            uploaded_at = d.get("uploaded_at")
            if uploaded_at:
                try:
                    record.uploaded_at = datetime.fromisoformat(uploaded_at)
                except ValueError:
                    pass
            parsed = ParsedPaper(
                paper_id=paper_id,
                full_markdown=d["full_markdown"],
                sections=d.get("sections") or {},
            )
            await papers_store.put(paper_id, {"record": record, "parsed": parsed, "status": "ready"})
            n_papers += 1

        n_strategies = 0
        for d in strategy_docs:
            strategy_id = d.get("strategy_id")
            if not strategy_id:
                continue
            if d.get("kind") == "spec" and d.get("spec"):
                try:
                    value: object = StrategySpec.model_validate(d["spec"])
                except Exception:
                    logger.warning("memory.reload_bad_spec strategy_id=%s", strategy_id)
                    continue
            elif d.get("kind") == "code" and d.get("strategy_code"):
                try:
                    config = PortfolioConfig.model_validate(d.get("portfolio_config") or {})
                except Exception:
                    logger.warning("memory.reload_bad_config strategy_id=%s", strategy_id)
                    continue
                value = {
                    "strategy_code": d["strategy_code"],
                    "portfolio_config": config,
                }
            else:
                continue
            await strategies_store.put(strategy_id, value)
            n_strategies += 1

        logger.info("memory.reloaded papers=%d strategies=%d", n_papers, n_strategies)
        return n_papers, n_strategies
