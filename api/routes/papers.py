import ipaddress
import socket
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, HttpUrl

from core.document.extractor import extract_sections
from core.document.parser import parse_pdf, parse_url
from core.models.paper import ParsedPaper, PaperRecord

router = APIRouter(prefix="/papers", tags=["papers"])

_PRIVATE_NETS = [
    ipaddress.ip_network(n) for n in (
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
        "127.0.0.0/8", "169.254.0.0/16", "::1/128", "fc00::/7",
    )
]


def _check_ssrf(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "url must use http or https")
    try:
        addr = ipaddress.ip_address(socket.gethostbyname(parsed.hostname or ""))
    except (socket.gaierror, ValueError):
        return  # non-resolvable at check time; let docling handle the error
    if any(addr in net for net in _PRIVATE_NETS):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "url resolves to a private address")


class PaperURLBody(BaseModel):
    url: HttpUrl


async def _parse_and_store(
    request: Request, paper_id: str, markdown: str, record: PaperRecord
) -> dict:
    sections = extract_sections(markdown)
    parsed = ParsedPaper(paper_id=paper_id, full_markdown=markdown, sections=sections)
    await request.app.state.papers.put(paper_id, {"record": record, "parsed": parsed})
    return {
        "paper_id": paper_id,
        "filename": record.filename,
        "source_url": record.source_url,
        "uploaded_at": record.uploaded_at.isoformat(),
        "sections_found": [k for k, v in sections.items() if v],
        "markdown_length": len(markdown),
    }


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_paper(request: Request, file: UploadFile):
    pdf_bytes = await file.read()

    try:
        markdown = await parse_pdf(pdf_bytes)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    paper_id = str(uuid.uuid4())
    record = PaperRecord(paper_id=paper_id, filename=file.filename)
    return await _parse_and_store(request, paper_id, markdown, record)


@router.post("/url", status_code=status.HTTP_201_CREATED)
async def paper_from_url(request: Request, body: PaperURLBody):
    url = str(body.url)
    _check_ssrf(url)

    try:
        markdown = await parse_url(url)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    paper_id = str(uuid.uuid4())
    record = PaperRecord(paper_id=paper_id, source_url=url)
    return await _parse_and_store(request, paper_id, markdown, record)
