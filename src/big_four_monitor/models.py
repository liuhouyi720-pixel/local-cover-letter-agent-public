from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


JobStatus = Literal["new", "active", "updated", "closed", "fetch_failed"]


class SearchRecord(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    firm: str
    source: str
    source_job_id: str
    title: str
    location_summary: str | None = None
    service_line: str | None = None
    career_level: str | None = None
    country: str | None = None
    detail_url: str

    @field_validator("firm", "source", "source_job_id", "title", "detail_url")
    @classmethod
    def required_text(cls, value: str) -> str:
        if not value:
            raise ValueError("must not be empty")
        return value


class JobPosting(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    firm: str
    source: str
    source_job_id: str
    title: str
    service_line: str | None = None
    career_level: str | None = None
    employment_type: str | None = None
    locations: list[str] = Field(default_factory=list)
    country: str
    detail_url: str
    apply_url: str | None = None
    description: str | None = None
    posted_date: str | None = None
    application_deadline: str | None = None
    first_seen_at: datetime
    last_seen_at: datetime
    status: JobStatus
    content_hash: str | None = None
