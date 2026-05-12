import re

_SECTION_KEYS = ["abstract", "introduction", "methodology", "results", "findings", "conclusion"]

# ~4 chars per token; cap each section at 4 000 tokens
_MAX_CHARS = 16_000


def extract_sections(markdown: str) -> dict[str, str]:
    sections: dict[str, str] = {key: "" for key in _SECTION_KEYS}

    # Split on any heading level (##, ###, etc.) or top-level (#)
    parts = re.split(r"(?m)^#{1,6}\s+", markdown)
    headings = re.findall(r"(?m)^#{1,6}\s+(.+)", markdown)

    for heading, body in zip(headings, parts[1:]):
        canonical = heading.strip().lower()
        for key in _SECTION_KEYS:
            if key in canonical and sections[key] == "":
                sections[key] = body.strip()[:_MAX_CHARS]
                break

    return sections
