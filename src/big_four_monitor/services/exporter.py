import csv
import json
from pathlib import Path
from typing import Any

from ..storage.models import CrawlRunRow, JobRow
from ..storage.repository import JobRepository
from .notifier import write_email_preview


CSV_FIELDS = [
    "firm",
    "source_job_id",
    "title",
    "service_line",
    "career_level",
    "employment_type",
    "location_summary",
    "country",
    "posted_date",
    "application_deadline",
    "detail_url",
    "apply_url",
    "status",
    "first_seen_at",
    "last_seen_at",
]


def _row(job: JobRow) -> dict[str, Any]:
    return {
        "firm": job.firm,
        "source_job_id": job.source_job_id,
        "title": job.title,
        "service_line": job.service_line,
        "career_level": job.career_level,
        "employment_type": job.employment_type,
        "location_summary": job.location_summary,
        "country": job.country,
        "posted_date": job.posted_date,
        "application_deadline": job.application_deadline,
        "detail_url": job.detail_url,
        "apply_url": job.apply_url,
        "status": job.status,
        "first_seen_at": job.first_seen_at.isoformat(),
        "last_seen_at": job.last_seen_at.isoformat(),
    }


def _write_csv(path: Path, jobs: list[JobRow]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(_row(job) for job in jobs)


def run_to_summary(run: CrawlRunRow, active_count: int) -> dict[str, Any]:
    return {
        "run_id": run.id,
        "firm": run.firm,
        "source": run.source,
        "started_at": run.started_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "status": run.status,
        "pages_fetched": run.pages_fetched,
        "records_found": run.records_found,
        "matching_jobs": run.matching_jobs,
        "new_jobs": run.new_jobs,
        "updated_jobs": run.updated_jobs,
        "unchanged_jobs": run.unchanged_jobs,
        "closed_jobs": run.closed_jobs,
        "detail_failures": run.detail_failures,
        "active_matching_jobs": active_count,
        "email_sent": False,
    }


def export_outputs(
    repository: JobRepository, output_directory: Path
) -> dict[str, Any]:
    run = repository.latest_successful_run()
    if run is None:
        raise RuntimeError("No successful crawl exists. Run crawl --firm pwc first.")
    latest = repository.jobs_for_export()
    new = repository.jobs_for_export(run.id, "new")
    updated = repository.jobs_for_export(run.id, "updated")
    output_directory.mkdir(parents=True, exist_ok=True)
    _write_csv(output_directory / "latest_jobs.csv", latest)
    _write_csv(output_directory / "new_jobs.csv", new)
    _write_csv(output_directory / "updated_jobs.csv", updated)
    summary = run_to_summary(run, len(latest))
    (output_directory / "run_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    write_email_preview(
        output_directory / "email_preview.html",
        new_jobs=new,
        updated_jobs=updated,
        summary=summary,
    )
    return summary
