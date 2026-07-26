from dataclasses import dataclass
import re

from ..models import JobPosting, SearchRecord


TARGET_TERMS = (
    "intern",
    "internship",
    "trainee",
    "student",
    "campus",
    "graduate",
    "early career",
    "entry level",
    "analyst",
    "associate",
    "staff",
    "co-op",
)
BUSINESS_TERMS = (
    "audit",
    "assurance",
    "tax",
    "accounting",
    "advisory",
    "consulting",
    "risk",
    "deals",
    "strategy",
    "technology",
    "analytics",
    "data",
    "cyber",
    "finance",
    "operations",
    "transformation",
    "controls",
    "compliance",
    "business",
)
EXCLUDED_SENIORITY_TERMS = (
    "senior associate",
    "senior consultant",
    "manager",
    "senior manager",
    "director",
    "managing director",
    "principal",
    "partner",
)


@dataclass(frozen=True)
class MatchResult:
    matches: bool
    reason: str


def _contains(text: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.IGNORECASE) is not None


def matches_early_career(record: SearchRecord | JobPosting) -> MatchResult:
    title = record.title or ""
    career_level = record.career_level or ""
    seniority_text = f"{title} {career_level}"
    for term in EXCLUDED_SENIORITY_TERMS:
        if _contains(seniority_text, term):
            return MatchResult(False, f"excluded seniority term: {term}")

    target_text = f"{title} {career_level}"
    for term in TARGET_TERMS:
        if _contains(target_text, term):
            return MatchResult(True, f"target term: {term}")
    return MatchResult(False, "no early-career target term")
