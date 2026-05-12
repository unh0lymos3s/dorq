from datetime import datetime
from pydantic import BaseModel


class PaperRecord(BaseModel):
    paper_id: str
    filename: str | None = None
    source_url: str | None = None
    uploaded_at: datetime


class ParsedPaper(BaseModel):
    paper_id: str
    full_markdown: str
    sections: dict[str, str]
