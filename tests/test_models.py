from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from big_four_monitor.models import JobPosting, SearchRecord


def test_search_record_rejects_empty_identity() -> None:
    with pytest.raises(ValidationError):
        SearchRecord(
            firm="pwc",
            source="official",
            source_job_id="",
            title="Intern",
            detail_url="https://example.com/job",
        )


def test_job_posting_accepts_defined_status() -> None:
    now = datetime.now(timezone.utc)
    posting = JobPosting(
        firm="pwc",
        source="official",
        source_job_id="1",
        title="Audit Intern",
        locations=["Chicago, Illinois"],
        country="United States",
        detail_url="https://example.com/job",
        first_seen_at=now,
        last_seen_at=now,
        status="new",
    )
    assert posting.status == "new"


def test_job_posting_rejects_unknown_status() -> None:
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError):
        JobPosting(
            firm="pwc",
            source="official",
            source_job_id="1",
            title="Audit Intern",
            country="United States",
            detail_url="https://example.com/job",
            first_seen_at=now,
            last_seen_at=now,
            status="missing",
        )
