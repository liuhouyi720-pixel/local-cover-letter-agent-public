from big_four_monitor.filtering.early_career import matches_early_career
from big_four_monitor.models import SearchRecord


def record(title: str, level: str | None = None) -> SearchRecord:
    return SearchRecord(
        firm="pwc",
        source="official",
        source_job_id=title,
        title=title,
        career_level=level,
        detail_url="https://example.com/job",
    )


def test_matches_early_career_target() -> None:
    assert matches_early_career(record("Audit Intern")).matches


def test_excludes_senior_title() -> None:
    result = matches_early_career(record("Audit Senior Associate"))
    assert not result.matches
    assert "excluded seniority" in result.reason


def test_excludes_structured_manager_level() -> None:
    assert not matches_early_career(
        record("Technology Associate", "Manager")
    ).matches


def test_does_not_filter_on_description_text() -> None:
    assert matches_early_career(record("Risk Associate")).matches
