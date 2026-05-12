import asyncio
import tempfile
from pathlib import Path


def _convert_pdf(pdf_bytes: bytes) -> str:
    from docling.document_converter import DocumentConverter

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        tmp_path = f.name

    try:
        result = DocumentConverter().convert(tmp_path)
        return result.document.export_to_markdown()
    except Exception as exc:
        raise ValueError(f"docling_parse_error: {exc}") from exc
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _convert_url(url: str) -> str:
    from docling.document_converter import DocumentConverter

    try:
        result = DocumentConverter().convert(url)
        return result.document.export_to_markdown()
    except Exception as exc:
        raise ValueError(f"docling_parse_error: {exc}") from exc


async def parse_pdf(pdf_bytes: bytes) -> str:
    return await asyncio.get_event_loop().run_in_executor(None, _convert_pdf, pdf_bytes)


async def parse_url(url: str) -> str:
    return await asyncio.get_event_loop().run_in_executor(None, _convert_url, url)
