import uuid

from fastapi import APIRouter, HTTPException, Request, UploadFile, status

from core.document.extractor import extract_sections
from core.document.parser import parse_pdf, parse_url
from core.models.paper import ParsedPaper, PaperRecord

router = APIRouter(prefix="/papers", tags=["papers"])


async def _build_parsed_paper(paper_id: str, markdown: str) -> ParsedPaper:
    sections = extract_sections(markdown)
    return ParsedPaper(paper_id=paper_id, full_markdown=markdown, sections=sections)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_paper(request: Request, file: UploadFile):
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "file must be a PDF")

    pdf_bytes = await file.read()
    paper_id = str(uuid.uuid4())

    try:
        markdown = await parse_pdf(pdf_bytes)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    record = PaperRecord(paper_id=paper_id, filename=file.filename)
    parsed = await _build_parsed_paper(paper_id, markdown)
    request.app.state.papers[paper_id] = parsed

    return {
        "paper_id": paper_id,
        "filename": record.filename,
        "uploaded_at": record.uploaded_at.isoformat(),
        "sections_found": [k for k, v in parsed.sections.items() if v],
        "markdown_length": len(markdown),
    }


@router.post("/url", status_code=status.HTTP_201_CREATED)
async def paper_from_url(request: Request, body: dict):
    url = body.get("url")
    if not url or not isinstance(url, str):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "url is required")

    paper_id = str(uuid.uuid4())

    try:
        markdown = await parse_url(url)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    record = PaperRecord(paper_id=paper_id, source_url=url)
    parsed = await _build_parsed_paper(paper_id, markdown)
    request.app.state.papers[paper_id] = parsed

    return {
        "paper_id": paper_id,
        "source_url": record.source_url,
        "uploaded_at": record.uploaded_at.isoformat(),
        "sections_found": [k for k, v in parsed.sections.items() if v],
        "markdown_length": len(markdown),
    }
