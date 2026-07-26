from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, selectinload

from ..models import JobPosting, SearchRecord
from ..parsing.locations import parse_location
from ..services.change_detector import has_meaningful_change
from ..utils.hashing import posting_content_hash
from .models import CrawlRunRow, JobLocationRow, JobRow, RunJobChangeRow


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class UpsertResult:
    change_type: str
    job_id: int


class JobRepository:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def begin_run(self, firm: str, source: str) -> int:
        with Session(self.engine) as session:
            run = CrawlRunRow(
                firm=firm,
                source=source,
                started_at=utc_now(),
                status="running",
            )
            session.add(run)
            session.commit()
            return run.id

    def get_job(self, firm: str, source_job_id: str) -> JobRow | None:
        with Session(self.engine) as session:
            return session.scalar(
                select(JobRow)
                .options(selectinload(JobRow.locations))
                .where(
                    JobRow.firm == firm,
                    JobRow.source_job_id == source_job_id,
                )
            )

    def needs_detail(self, record: SearchRecord, is_matching: bool) -> bool:
        if not is_matching:
            return False
        existing = self.get_job(record.firm, record.source_job_id)
        if existing is None or existing.status == "fetch_failed":
            return True
        return any(
            (
                existing.title != record.title,
                existing.career_level != record.career_level,
                existing.service_line != record.service_line
                and record.service_line is not None,
                existing.location_summary != record.location_summary
                and record.location_summary not in {None, "Multiple Locations"},
                existing.detail_url != record.detail_url,
            )
        )

    def upsert_job(
        self,
        posting: JobPosting,
        *,
        run_id: int,
        is_matching: bool,
    ) -> UpsertResult:
        content_hash = posting.content_hash or posting_content_hash(posting)
        location_summary = "; ".join(posting.locations) or None
        with Session(self.engine) as session:
            existing = session.scalar(
                select(JobRow)
                .options(selectinload(JobRow.locations))
                .where(
                    JobRow.firm == posting.firm,
                    JobRow.source_job_id == posting.source_job_id,
                )
            )
            if existing is None:
                job = JobRow(
                    firm=posting.firm,
                    source=posting.source,
                    source_job_id=posting.source_job_id,
                    title=posting.title,
                    service_line=posting.service_line,
                    career_level=posting.career_level,
                    employment_type=posting.employment_type,
                    country=posting.country,
                    location_summary=location_summary,
                    detail_url=posting.detail_url,
                    apply_url=posting.apply_url,
                    description=posting.description,
                    posted_date=posting.posted_date,
                    application_deadline=posting.application_deadline,
                    first_seen_at=posting.first_seen_at,
                    last_seen_at=posting.last_seen_at,
                    status=posting.status,
                    content_hash=content_hash,
                    missing_run_count=0,
                    is_matching=is_matching,
                )
                session.add(job)
                session.flush()
                change_type = "new"
            else:
                job = existing
                reopened = job.status == "closed"
                changed = has_meaningful_change(job.content_hash, content_hash)
                if posting.status == "fetch_failed":
                    change_type = "active"
                    job.status = "fetch_failed"
                    job.source = posting.source
                    job.title = posting.title
                    job.career_level = posting.career_level or job.career_level
                    job.country = posting.country
                    job.detail_url = posting.detail_url
                    job.last_seen_at = posting.last_seen_at
                    job.missing_run_count = 0
                    job.is_matching = is_matching
                    session.flush()
                    session.add(
                        RunJobChangeRow(
                            run_id=run_id,
                            job_id=job.id,
                            change_type=change_type,
                            is_matching=is_matching,
                        )
                    )
                    session.commit()
                    return UpsertResult(
                        change_type=change_type, job_id=job.id
                    )
                elif reopened:
                    change_type = "updated"
                    job.status = "active"
                elif changed:
                    change_type = "updated"
                    job.status = "updated"
                else:
                    change_type = "active"
                    job.status = "active"

                job.source = posting.source
                job.title = posting.title
                job.service_line = posting.service_line
                job.career_level = posting.career_level
                job.employment_type = posting.employment_type
                job.country = posting.country
                job.location_summary = location_summary
                job.detail_url = posting.detail_url
                job.apply_url = posting.apply_url
                job.description = posting.description
                job.posted_date = posting.posted_date
                job.application_deadline = posting.application_deadline
                job.last_seen_at = posting.last_seen_at
                job.content_hash = content_hash
                job.missing_run_count = 0
                job.is_matching = is_matching
                job.locations.clear()

            for raw_location in posting.locations:
                parsed = parse_location(raw_location, posting.country)
                job.locations.append(JobLocationRow(**parsed))
            session.flush()
            session.add(
                RunJobChangeRow(
                    run_id=run_id,
                    job_id=job.id,
                    change_type=change_type,
                    is_matching=is_matching,
                )
            )
            session.commit()
            return UpsertResult(change_type=change_type, job_id=job.id)

    def complete_run(
        self,
        run_id: int,
        *,
        source: str,
        seen_job_ids: set[str],
        pages_fetched: int,
        records_found: int,
        matching_jobs: int,
        new_jobs: int,
        updated_jobs: int,
        unchanged_jobs: int,
        detail_failures: int,
    ) -> int:
        closed_count = 0
        with Session(self.engine) as session:
            missing_jobs = session.scalars(
                select(JobRow).where(
                    JobRow.source == source,
                    JobRow.status != "closed",
                    JobRow.source_job_id.not_in(seen_job_ids),
                )
            ).all()
            for job in missing_jobs:
                job.missing_run_count += 1
                if job.missing_run_count >= 2:
                    job.status = "closed"
                    closed_count += 1
                    session.add(
                        RunJobChangeRow(
                            run_id=run_id,
                            job_id=job.id,
                            change_type="closed",
                            is_matching=job.is_matching,
                        )
                    )

            run = session.get(CrawlRunRow, run_id)
            assert run is not None
            run.finished_at = utc_now()
            run.status = "success"
            run.pages_fetched = pages_fetched
            run.records_found = records_found
            run.matching_jobs = matching_jobs
            run.new_jobs = new_jobs
            run.updated_jobs = updated_jobs
            run.unchanged_jobs = unchanged_jobs
            run.closed_jobs = closed_count
            run.detail_failures = detail_failures
            session.commit()
        return closed_count

    def fail_run(
        self,
        run_id: int,
        error_message: str,
        *,
        status: str = "failed",
        pages_fetched: int = 0,
    ) -> None:
        with Session(self.engine) as session:
            run = session.get(CrawlRunRow, run_id)
            assert run is not None
            run.finished_at = utc_now()
            run.status = status
            run.pages_fetched = pages_fetched
            run.error_message = error_message
            session.commit()

    def latest_successful_run(self) -> CrawlRunRow | None:
        with Session(self.engine) as session:
            return session.scalar(
                select(CrawlRunRow)
                .where(CrawlRunRow.status == "success")
                .order_by(CrawlRunRow.id.desc())
                .limit(1)
            )

    def jobs_for_export(
        self, run_id: int | None = None, change_type: str | None = None
    ) -> list[JobRow]:
        with Session(self.engine) as session:
            statement = (
                select(JobRow)
                .options(selectinload(JobRow.locations))
                .where(JobRow.is_matching.is_(True))
            )
            if run_id is None:
                statement = statement.where(JobRow.status != "closed")
            else:
                statement = statement.join(
                    RunJobChangeRow, RunJobChangeRow.job_id == JobRow.id
                ).where(RunJobChangeRow.run_id == run_id)
                if change_type:
                    statement = statement.where(
                        RunJobChangeRow.change_type == change_type
                    )
            return list(
                session.scalars(
                    statement.order_by(JobRow.title.collate("NOCASE"))
                ).all()
            )

    def status_summary(self) -> dict[str, Any]:
        with Session(self.engine) as session:
            total_jobs = session.scalar(select(func.count(JobRow.id))) or 0
            matching_jobs = (
                session.scalar(
                    select(func.count(JobRow.id)).where(
                        JobRow.is_matching.is_(True),
                        JobRow.status != "closed",
                    )
                )
                or 0
            )
            closed_jobs = (
                session.scalar(
                    select(func.count(JobRow.id)).where(JobRow.status == "closed")
                )
                or 0
            )
            total_runs = session.scalar(select(func.count(CrawlRunRow.id))) or 0
            latest = session.scalar(
                select(CrawlRunRow).order_by(CrawlRunRow.id.desc()).limit(1)
            )
            return {
                "total_jobs": total_jobs,
                "matching_active_jobs": matching_jobs,
                "closed_jobs": closed_jobs,
                "total_runs": total_runs,
                "latest_run": latest,
            }
