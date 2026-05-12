import asyncio
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path

# Dedicated pool — docling is CPU/torch-heavy; 2 workers prevents GIL thrash
_PARSE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="docling")

_PARSE_TIMEOUT = 120  # seconds
_MAX_PDF_BYTES = 50 * 1024 * 1024  # 50 MB


@lru_cache(maxsize=1)
def _converter():
    from docling.document_converter import DocumentConverter
    return DocumentConverter()


def warmup() -> None:
    """Pre-load docling weights at startup so the first request isn't slow."""
    _converter()


def _convert_path(path: str) -> str:
    try:
        return _converter().convert(path).document.export_to_markdown()
    except Exception as exc:
        raise ValueError(f"docling_parse_error: {exc}") from exc


async def _run(path: str) -> str:
    loop = asyncio.get_running_loop()
    return await asyncio.wait_for(
        loop.run_in_executor(_PARSE_POOL, _convert_path, path),
        timeout=_PARSE_TIMEOUT,
    )


async def parse_pdf(pdf_bytes: bytes) -> str:
    if len(pdf_bytes) > _MAX_PDF_BYTES:
        raise ValueError("docling_parse_error: file exceeds 50 MB limit")
    if pdf_bytes[:5] != b"%PDF-":
        raise ValueError("docling_parse_error: file is not a valid PDF")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        tmp_path = f.name

    try:
        return await _run(tmp_path)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


async def parse_url(url: str) -> str:
    return await _run(url)
