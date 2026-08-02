import asyncio
import ipaddress
import logging
import socket
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, HttpUrl

from core.document.extractor import extract_sections
from core.document.parser import parse_pdf, parse_url, validate_pdf
from core.errors import ERR_NOT_FOUND, raise_http
from core.models.paper import ParsedPaper, PaperRecord

router = APIRouter(prefix="/papers", tags=["papers"])
logger = logging.getLogger("dorq." + __name__)

_PRIVATE_NETS = [
    ipaddress.ip_network(n) for n in (
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
        "127.0.0.0/8", "169.254.0.0/16", "::1/128", "fc00::/7",
    )
]

# Strong references to in-flight parse tasks — create_task alone is collectable.
_parse_tasks: set[asyncio.Task] = set()


def _check_ssrf(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "url must use http or https")
    try:
        addr = ipaddress.ip_address(socket.gethostbyname(parsed.hostname or ""))
    except (socket.gaierror, ValueError):
        return
    if any(addr in net for net in _PRIVATE_NETS):
        logger.info("paper.url ssrf_blocked url=%r addr=%s", url, addr)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "url resolves to a private address")


class PaperURLBody(BaseModel):
    url: HttpUrl


def _accepted_payload(record: PaperRecord) -> dict:
    return {
        "paper_id": record.paper_id,
        "status": "parsing",
        "filename": record.filename,
        "source_url": record.source_url,
        "uploaded_at": record.uploaded_at.isoformat(),
    }


def _status_payload(entry: dict) -> dict:
    record: PaperRecord = entry["record"]
    # Entries rehydrated by the memory engine predate the status field.
    st = entry.get("status", "ready")
    payload = {
        "paper_id": record.paper_id,
        "status": st,
        "filename": record.filename,
        "source_url": record.source_url,
        "uploaded_at": record.uploaded_at.isoformat(),
    }
    if st == "ready":
        parsed: ParsedPaper = entry["parsed"]
        payload["sections_found"] = [k for k, v in parsed.sections.items() if v]
        payload["markdown_length"] = len(parsed.full_markdown)
    elif st == "error":
        payload["error"] = entry.get("error", "parse_runtime_error")
    return payload


async def _store_parsed(app: FastAPI, record: PaperRecord, markdown: str) -> None:
    sections = extract_sections(markdown)
    parsed = ParsedPaper(paper_id=record.paper_id, full_markdown=markdown, sections=sections)
    await app.state.papers.put(
        record.paper_id, {"record": record, "parsed": parsed, "status": "ready"}
    )

    # Mirror to the persistent memory engine (embeds in the background).
    memory = getattr(app.state, "memory", None)
    if memory is not None:
        await memory.add_paper(record, parsed)


async def _parse_in_background(app: FastAPI, record: PaperRecord, parse_coro) -> None:
    source = record.filename or record.source_url
    try:
        markdown = await parse_coro
    except ValueError as exc:
        logger.info("paper.parse failed paper_id=%s source=%r error=%s",
                    record.paper_id, source, exc)
        await app.state.papers.put(
            record.paper_id, {"record": record, "status": "error", "error": str(exc)}
        )
        return
    except Exception:
        logger.error("paper.parse error paper_id=%s source=%r",
                     record.paper_id, source, exc_info=True)
        await app.state.papers.put(
            record.paper_id, {"record": record, "status": "error", "error": "parse_runtime_error"}
        )
        return

    await _store_parsed(app, record, markdown)
    logger.info("paper.parse done paper_id=%s source=%r md_len=%d",
                record.paper_id, source, len(markdown))


def _spawn_parse(app: FastAPI, record: PaperRecord, parse_coro) -> None:
    task = asyncio.create_task(_parse_in_background(app, record, parse_coro))
    _parse_tasks.add(task)
    task.add_done_callback(_parse_tasks.discard)


@router.get("")
async def list_papers(request: Request) -> list[dict]:
    """Summaries of every paper in the session store, most recent first."""
    entries = await request.app.state.papers.items()
    out = []
    for paper_id, entry in entries:
        parsed = entry.get("parsed")
        out.append({
            "paper_id": paper_id,
            "filename": entry["record"].filename,
            "source_url": entry["record"].source_url,
            "uploaded_at": entry["record"].uploaded_at.isoformat(),
            "status": entry.get("status", "ready"),
            "markdown_length": len(parsed.full_markdown) if parsed else 0,
        })
    return out


@router.get("/{paper_id}")
async def paper_status(request: Request, paper_id: str) -> dict:
    """Parse status for one paper: parsing | ready | error."""
    entry = await request.app.state.papers.get(paper_id)
    if entry is None:
        raise_http(status.HTTP_404_NOT_FOUND, ERR_NOT_FOUND, f"paper {paper_id!r} not found")
    return _status_payload(entry)


@router.post("/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_paper(request: Request, file: UploadFile):
    """Accept the PDF and parse it in the background.

    Returns 202 with the paper_id immediately — docling can run for minutes,
    and holding the HTTP response open that long gets requests severed by
    proxies and flaky links. Clients poll GET /papers/{paper_id}.
    """
    pdf_bytes = await file.read()
    logger.info("paper.upload filename=%r size=%d", file.filename, len(pdf_bytes))

    try:
        validate_pdf(pdf_bytes)
    except ValueError as exc:
        logger.info("paper.upload rejected filename=%r error=%s", file.filename, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    paper_id = str(uuid.uuid4())
    record = PaperRecord(paper_id=paper_id, filename=file.filename)
    await request.app.state.papers.put(paper_id, {"record": record, "status": "parsing"})
    _spawn_parse(request.app, record, parse_pdf(pdf_bytes))
    return _accepted_payload(record)


@router.post("/url", status_code=status.HTTP_202_ACCEPTED)
async def paper_from_url(request: Request, body: PaperURLBody):
    """Accept the URL and parse it in the background (see upload_paper)."""
    url = str(body.url)
    logger.info("paper.url url=%r", url)
    _check_ssrf(url)

    paper_id = str(uuid.uuid4())
    record = PaperRecord(paper_id=paper_id, source_url=url)
    await request.app.state.papers.put(paper_id, {"record": record, "status": "parsing"})
    _spawn_parse(request.app, record, parse_url(url))
    return _accepted_payload(record)
