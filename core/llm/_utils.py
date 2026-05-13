import re

_FENCE_RE = re.compile(r"^```[^\n]*\n(.*?)\n```", re.DOTALL)


def _strip_fences(text: str) -> str:
    s = text.strip()
    m = _FENCE_RE.match(s)
    return m.group(1).strip() if m else s
