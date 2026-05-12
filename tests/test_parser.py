"""
Tests for core/document/parser.py and core/document/extractor.py.

parse_pdf / parse_url call docling which downloads ML models on first run
and is slow; these tests are marked integration and skipped in CI unless
DORQ_RUN_INTEGRATION=1 is set.
"""

import os
import textwrap

import pytest

from core.document.extractor import extract_sections

SKIP_INTEGRATION = not os.getenv("DORQ_RUN_INTEGRATION")


# ---------------------------------------------------------------------------
# extractor — pure-Python, always runs
# ---------------------------------------------------------------------------

SAMPLE_MARKDOWN = textwrap.dedent("""
    # A Research Paper

    ## Abstract

    This paper studies momentum strategies in equity markets.

    ## Introduction

    Momentum has been documented since the 1990s.

    ## Methodology

    We sort stocks into deciles by 12-1 month return.

    ## Results

    The top decile outperforms by 1% per month.

    ## Conclusion

    Momentum is a robust anomaly.
""").strip()


def test_extract_sections_finds_known_headings():
    sections = extract_sections(SAMPLE_MARKDOWN)
    assert sections["abstract"] != ""
    assert sections["methodology"] != ""
    assert sections["results"] != ""
    assert sections["conclusion"] != ""


def test_extract_sections_missing_heading_returns_empty_string():
    sections = extract_sections(SAMPLE_MARKDOWN)
    assert sections["findings"] == ""


def test_extract_sections_always_returns_all_keys():
    sections = extract_sections("")
    expected = {"abstract", "introduction", "methodology", "results", "findings", "conclusion"}
    assert set(sections.keys()) == expected


def test_extract_sections_truncates_to_max_chars():
    long_body = "word " * 5000  # ~25 000 chars
    md = f"## Abstract\n\n{long_body}"
    sections = extract_sections(md)
    assert len(sections["abstract"]) <= 16_000


def test_extract_sections_case_insensitive():
    md = "## METHODOLOGY\n\nWe used OLS regression."
    sections = extract_sections(md)
    assert sections["methodology"] != ""


# ---------------------------------------------------------------------------
# parser — integration, requires docling + network (model download)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(SKIP_INTEGRATION, reason="set DORQ_RUN_INTEGRATION=1 to run")
@pytest.mark.asyncio
async def test_parse_url_returns_nonempty_markdown():
    from core.document.parser import parse_url

    # Faber's Tactical Asset Allocation paper (public PDF)
    url = "https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID962461_code328883.pdf"
    markdown = await parse_url(url)
    assert isinstance(markdown, str)
    assert len(markdown) > 500


@pytest.mark.skipif(SKIP_INTEGRATION, reason="set DORQ_RUN_INTEGRATION=1 to run")
@pytest.mark.asyncio
async def test_parse_pdf_sections_nonempty(tmp_path):
    """Download a known PDF, parse it, assert at least one section extracted."""
    import httpx

    from core.document.parser import parse_pdf

    url = "https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID962461_code328883.pdf"
    async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
        resp = await client.get(url)
    resp.raise_for_status()

    markdown = await parse_pdf(resp.content)
    sections = extract_sections(markdown)
    assert any(v for v in sections.values()), "expected at least one non-empty section"
