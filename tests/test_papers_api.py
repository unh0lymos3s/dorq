"""Route tests for the background-parse paper endpoints."""

import asyncio

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.routes import papers as papers_routes
from core.stores import LRUStore

MARKDOWN = "## Abstract\n\nsome text\n\n## Introduction\n\nmore text"


def make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(papers_routes.router)
    app.state.papers = LRUStore(maxsize=8)
    return app


def make_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def poll_until_settled(client: AsyncClient, paper_id: str) -> dict:
    for _ in range(100):
        await asyncio.sleep(0.01)
        body = (await client.get(f"/papers/{paper_id}")).json()
        if body["status"] != "parsing":
            return body
    pytest.fail("parse never settled")


async def test_upload_parses_in_background(monkeypatch):
    gate = asyncio.Event()

    async def fake_parse(pdf_bytes: bytes) -> str:
        await gate.wait()
        return MARKDOWN

    monkeypatch.setattr(papers_routes, "parse_pdf", fake_parse)
    app = make_app()

    async with make_client(app) as client:
        res = await client.post(
            "/papers/upload",
            files={"file": ("paper.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
        assert res.status_code == 202
        accepted = res.json()
        paper_id = accepted["paper_id"]
        assert accepted["status"] == "parsing"
        assert accepted["filename"] == "paper.pdf"

        # Still parsing until the gate opens.
        res = await client.get(f"/papers/{paper_id}")
        assert res.json()["status"] == "parsing"

        gate.set()
        body = await poll_until_settled(client, paper_id)
        assert body["status"] == "ready"
        assert body["markdown_length"] == len(MARKDOWN)
        assert isinstance(body["sections_found"], list)

        # The list endpoint reflects the settled entry.
        rows = (await client.get("/papers")).json()
        assert rows[0]["paper_id"] == paper_id
        assert rows[0]["status"] == "ready"


async def test_upload_parse_failure_reports_error_status(monkeypatch):
    async def fake_parse(pdf_bytes: bytes) -> str:
        raise ValueError("docling_parse_error: boom")

    monkeypatch.setattr(papers_routes, "parse_pdf", fake_parse)
    app = make_app()

    async with make_client(app) as client:
        res = await client.post(
            "/papers/upload",
            files={"file": ("paper.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
        assert res.status_code == 202
        body = await poll_until_settled(client, res.json()["paper_id"])
        assert body["status"] == "error"
        assert body["error"].startswith("docling_parse_error")


async def test_upload_rejects_non_pdf_immediately():
    app = make_app()
    async with make_client(app) as client:
        res = await client.post(
            "/papers/upload",
            files={"file": ("paper.pdf", b"not a pdf", "application/pdf")},
        )
        assert res.status_code == 422
        assert "docling_parse_error" in res.json()["detail"]


async def test_status_unknown_paper_404():
    app = make_app()
    async with make_client(app) as client:
        res = await client.get("/papers/no-such-id")
        assert res.status_code == 404
