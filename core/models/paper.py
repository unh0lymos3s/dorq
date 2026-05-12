from datetime import datetime, timezone
from pydantic import BaseModel, Field


class PaperRecord(BaseModel):
    paper_id: str
    filename: str | None = None
    source_url: str | None = None
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ParsedPaper(BaseModel):
    paper_id: str
    full_markdown: str
    sections: dict[str, str]
