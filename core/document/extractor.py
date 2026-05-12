import re

# LLM context budget: ~4 000 tokens ≈ 16 000 chars per section
_MAX_CHARS = 16_000

_SECTION_SYNONYMS: dict[str, tuple[str, ...]] = {
    "abstract":     ("abstract", "summary"),
    "introduction": ("introduction", "background", "overview"),
    "methodology":  ("methodology", "methods", "materials and methods",
                     "experimental setup", "approach", "proposed method"),
    "results":      ("results", "experiments", "evaluation", "empirical results"),
    "findings":     ("findings", "key findings", "discussion"),
    "conclusion":   ("conclusion", "conclusions", "concluding remarks",
                     "summary and conclusion"),
}

# Strip leading numeric prefixes like "1.", "2.3 ", "3.1.2 "
_NUM_PREFIX = re.compile(r"^\s*\d+(\.\d+)*\.?\s*")

# Match each heading + everything until the next heading or end of string
_HEADING_RE = re.compile(r"(?ms)^#{1,6}[ \t]+(?P<h>.+?)$(?P<body>.*?)(?=^#{1,6}[ \t]+|\Z)")


def extract_sections(markdown: str) -> dict[str, str]:
    sections: dict[str, str] = {key: "" for key in _SECTION_SYNONYMS}

    for m in _HEADING_RE.finditer(markdown):
        norm = _NUM_PREFIX.sub("", m.group("h")).strip().lower()
        for key, synonyms in _SECTION_SYNONYMS.items():
            if sections[key]:
                continue
            if any(norm == s or norm.startswith(s + " ") or norm.startswith(s + ":") for s in synonyms):
                sections[key] = m.group("body").strip()[:_MAX_CHARS]
                break

    return sections
