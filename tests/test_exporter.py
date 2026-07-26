import csv
import json
from pathlib import Path

from big_four_monitor.services.exporter import export_outputs
from big_four_monitor.storage.database import build_engine, init_database
from big_four_monitor.storage.repository import JobRepository

from .test_change_detector import posting


def test_export_creates_required_files(tmp_path: Path) -> None:
    engine = build_engine(tmp_path / "data" / "jobs.db")
    init_database(engine)
    repo = JobRepository(engine)
    run_id = repo.begin_run("pwc", "pwc_us_talentbrew")
    repo.upsert_job(posting(), run_id=run_id, is_matching=True)
    repo.complete_run(
        run_id,
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

    output_directory = tmp_path / "outputs"
    summary = export_outputs(repo, output_directory)
    expected = {
        "latest_jobs.csv",
        "new_jobs.csv",
        "updated_jobs.csv",
        "run_summary.json",
        "email_preview.html",
    }
    assert {path.name for path in output_directory.iterdir()} == expected
    with (output_directory / "new_jobs.csv").open(
        encoding="utf-8-sig", newline=""
    ) as source:
        rows = list(csv.DictReader(source))
    assert len(rows) == 1
    assert rows[0]["apply_url"].startswith("https://pwc.wd3")
    saved_summary = json.loads(
        (output_directory / "run_summary.json").read_text(encoding="utf-8")
    )
    assert saved_summary["email_sent"] is False
    assert summary["new_jobs"] == 1
    assert "No email was sent" in (
        output_directory / "email_preview.html"
    ).read_text(encoding="utf-8")
