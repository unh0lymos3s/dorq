import ipaddress
import logging
import socket
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, HttpUrl

from core.document.extractor import extract_sections
from core.document.parser import parse_pdf, parse_url
from core.models.paper import ParsedPaper, PaperRecord

router = APIRouter(prefix="/papers", tags=["papers"])
logger = logging.getLogger("dorq." + __name__)

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
        return
    if any(addr in net for net in _PRIVATE_NETS):
        logger.info("paper.url ssrf_blocked url=%r addr=%s", url, addr)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "url resolves to a private address")


class PaperURLBody(BaseModel):
    url: HttpUrl


async def _parse_and_store(
    request: Request, paper_id: str, markdown: str, record: PaperRecord
) -> dict:
    sections = extract_sections(markdown)
    parsed = ParsedPaper(paper_id=paper_id, full_markdown=markdown, sections=sections)
    await request.app.state.papers.put(paper_id, {"record": record, "parsed": parsed})
    sections_found = [k for k, v in sections.items() if v]
    return {
        "paper_id": paper_id,
        "filename": record.filename,
        "source_url": record.source_url,
        "uploaded_at": record.uploaded_at.isoformat(),
        "sections_found": sections_found,
        "markdown_length": len(markdown),
    }


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_paper(request: Request, file: UploadFile):
    pdf_bytes = await file.read()
    logger.info("paper.upload filename=%r size=%d", file.filename, len(pdf_bytes))

    try:
        markdown = await parse_pdf(pdf_bytes)
    except ValueError as exc:
        logger.info("paper.upload failed filename=%r error=%s", file.filename, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:
        logger.error("paper.upload error filename=%r", file.filename, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "parse_runtime_error") from exc

    paper_id = str(uuid.uuid4())
    record = PaperRecord(paper_id=paper_id, filename=file.filename)
    result = await _parse_and_store(request, paper_id, markdown, record)
    logger.info("paper.upload done paper_id=%s sections=%s md_len=%d",
                paper_id, result["sections_found"], result["markdown_length"])
    return result


@router.post("/url", status_code=status.HTTP_201_CREATED)
async def paper_from_url(request: Request, body: PaperURLBody):
    url = str(body.url)
    logger.info("paper.url url=%r", url)
    _check_ssrf(url)

    try:
        markdown = await parse_url(url)
    except ValueError as exc:
        logger.info("paper.url failed url=%r error=%s", url, exc)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except Exception as exc:
        logger.error("paper.url error url=%r", url, exc_info=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "parse_runtime_error") from exc

    paper_id = str(uuid.uuid4())
    record = PaperRecord(paper_id=paper_id, source_url=url)
    result = await _parse_and_store(request, paper_id, markdown, record)
    logger.info("paper.url done paper_id=%s sections=%s md_len=%d",
                paper_id, result["sections_found"], result["markdown_length"])
    return result
