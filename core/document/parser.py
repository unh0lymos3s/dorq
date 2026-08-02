import asyncio
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

# Dedicated pool — docling is CPU/torch-heavy; 2 workers prevents GIL thrash
_PARSE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="docling")

_MAX_PDF_BYTES = 50 * 1024 * 1024  # 50 MB
_PDF_MAGIC = b"%PDF-"


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
    # No timeout: docling is CPU-bound and can run for minutes on a GPU-less
    # machine. Let it finish rather than aborting a slow-but-valid parse.
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_PARSE_POOL, _convert_path, path)


def _write_tmp_pdf(pdf_bytes: bytes) -> str:
    """Use low-level mkstemp + os.write — avoids NamedTemporaryFile's
    file-object/context-manager overhead and an extra Python frame."""
    fd, path = tempfile.mkstemp(suffix=".pdf")
    try:
        # os.write is a thin syscall wrapper; for large buffers it's a single write.
        os.write(fd, pdf_bytes)
    finally:
        os.close(fd)
    return path


def validate_pdf(pdf_bytes: bytes) -> None:
    """Cheap sanity checks, callable synchronously before a parse is queued."""
    # Validate without slicing (slicing allocates a new bytes object).
    if len(pdf_bytes) > _MAX_PDF_BYTES:
        raise ValueError("docling_parse_error: file exceeds 50 MB limit")
    if not pdf_bytes.startswith(_PDF_MAGIC):
        raise ValueError("docling_parse_error: file is not a valid PDF")


async def parse_pdf(pdf_bytes: bytes) -> str:
    validate_pdf(pdf_bytes)

    tmp_path = _write_tmp_pdf(pdf_bytes)
    try:
        return await _run(tmp_path)
    finally:
        # os.unlink is faster than Path(...).unlink() — skips PurePath object creation.
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass


async def parse_url(url: str) -> str:
    return await _run(url)
