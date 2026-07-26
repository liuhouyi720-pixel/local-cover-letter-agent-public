from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from big_four_monitor.models import JobPosting
from big_four_monitor.storage.database import build_engine, init_database
from big_four_monitor.storage.models import CrawlRunRow, JobRow
from big_four_monitor.storage.repository import JobRepository


def posting(
    source_job_id: str = "1001",
    *,
    title: str = "Audit Intern",
) -> JobPosting:
    now = datetime.now(timezone.utc)
    return JobPosting(
        firm="pwc",
        source="pwc_us_talentbrew",
        source_job_id=source_job_id,
        title=title,
        service_line="Audit and Assurance",
        career_level="Intern/Trainee",
        employment_type="Full time",
        locations=["Chicago, Illinois"],
        country="United States",
        detail_url=f"https://jobs.us.pwc.com/job/{source_job_id}",
        apply_url=f"https://pwc.wd3.myworkdayjobs.com/job/{source_job_id}",
        description="Public job description",
        first_seen_at=now,
        last_seen_at=now,
        status="new",
    )


def repository(tmp_path: Path) -> JobRepository:
    engine = build_engine(tmp_path / "jobs.db")
    init_database(engine)
    return JobRepository(engine)


def successful_run(
    repo: JobRepository,
    records: list[JobPosting],
    seen_ids: set[str],
) -> int:
    run_id = repo.begin_run("pwc", "pwc_us_talentbrew")
    for item in records:
        repo.upsert_job(item, run_id=run_id, is_matching=True)
    repo.complete_run(
        run_id,
        source="pwc_us_talentbrew",
        seen_job_ids=seen_ids,
        pages_fetched=1,
        records_found=len(records),
        matching_jobs=len(records),
        new_jobs=len(records),
        updated_jobs=0,
        unchanged_jobs=0,
        detail_failures=0,
    )
    return run_id


def test_new_and_updated_detection(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    first_run = repo.begin_run("pwc", "pwc_us_talentbrew")
    first = repo.upsert_job(posting(), run_id=first_run, is_matching=True)
    assert first.change_type == "new"
    repo.complete_run(
        first_run,
        source="pwc_us_talentbrew",
        seen_job_ids={"1001"},
        pages_fetched=1,
        records_found=1,
        matching_jobs=1,
        new_jobs=1,
        updated_jobs=0,
        unchanged_jobs=0,
        detail_failures=0,
    )

    second_run = repo.begin_run("pwc", "pwc_us_talentbrew")
    updated = repo.upsert_job(
        posting(title="Audit and Assurance Intern"),
        run_id=second_run,
        is_matching=True,
    )
    assert updated.change_type == "updated"


def test_first_missing_then_second_missing_closes(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    successful_run(repo, [posting()], {"1001"})

    first_missing_run = repo.begin_run("pwc", "pwc_us_talentbrew")
    closed = repo.complete_run(
        first_missing_run,
        source="pwc_us_talentbrew",
        seen_job_ids=set(),
        pages_fetched=1,
        records_found=0,
        matching_jobs=0,
        new_jobs=0,
        updated_jobs=0,
        unchanged_jobs=0,
        detail_failures=0,
    )
    assert closed == 0
    assert repo.get_job("pwc", "1001").missing_run_count == 1
    assert repo.get_job("pwc", "1001").status != "closed"

    second_missing_run = repo.begin_run("pwc", "pwc_us_talentbrew")
    closed = repo.complete_run(
        second_missing_run,
        source="pwc_us_talentbrew",
        seen_job_ids=set(),
        pages_fetched=1,
        records_found=0,
        matching_jobs=0,
        new_jobs=0,
        updated_jobs=0,
        unchanged_jobs=0,
        detail_failures=0,
    )
    assert closed == 1
    assert repo.get_job("pwc", "1001").status == "closed"


def test_reopened_job_becomes_active(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    successful_run(repo, [posting()], {"1001"})
    for _ in range(2):
        run_id = repo.begin_run("pwc", "pwc_us_talentbrew")
        repo.complete_run(
            run_id,
            source="pwc_us_talentbrew",
            seen_job_ids=set(),
            pages_fetched=1,
            records_found=0,
            matching_jobs=0,
            new_jobs=0,
            updated_jobs=0,
            unchanged_jobs=0,
            detail_failures=0,
        )

    reopen_run = repo.begin_run("pwc", "pwc_us_talentbrew")
    result = repo.upsert_job(
        posting(), run_id=reopen_run, is_matching=True
    )
    reopened = repo.get_job("pwc", "1001")
    assert result.change_type == "updated"
    assert reopened.status == "active"
    assert reopened.missing_run_count == 0


def test_failed_connector_run_does_not_increment_missing(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    successful_run(repo, [posting()], {"1001"})
    failed_run = repo.begin_run("pwc", "pwc_us_talentbrew")
    repo.fail_run(failed_run, "unexpected empty result")
    job = repo.get_job("pwc", "1001")
    assert job.missing_run_count == 0
    with Session(repo.engine) as session:
        run = session.get(CrawlRunRow, failed_run)
        assert run.status == "failed"
