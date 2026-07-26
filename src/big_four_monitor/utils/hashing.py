import hashlib
import json

from ..models import JobPosting


def posting_content_hash(posting: JobPosting) -> str:
    meaningful = {
        "title": posting.title,
        "locations": sorted(posting.locations),
        "career_level": posting.career_level,
        "service_line": posting.service_line,
        "apply_url": posting.apply_url,
        "application_deadline": posting.application_deadline,
        "description": posting.description,
    }
    payload = json.dumps(meaningful, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
