from pathlib import Path
from typing import Any

from jinja2 import BaseLoader, Environment, select_autoescape

from ..storage.models import JobRow


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Big Four US Job Monitor preview</title>
  <style>
    body { font: 16px/1.5 Arial, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { color: #d04a02; }
    .notice { padding: .75rem 1rem; background: #fff3e8; border-left: 4px solid #d04a02; }
    article { border-top: 1px solid #ddd; padding: 1rem 0; }
    dt { font-weight: bold; }
    dd { margin: 0 0 .35rem; }
  </style>
</head>
<body>
  <h1>Big Four US Job Monitor — PwC</h1>
  <p class="notice"><strong>Local preview only.</strong> No email was sent.</p>
  <p>Run {{ summary.run_id }}: {{ summary.new_jobs }} new,
     {{ summary.updated_jobs }} updated, and {{ summary.detail_failures }}
     detail-fetch failures.</p>
  {% for heading, items in groups %}
  <h2>{{ heading }}</h2>
  {% if items %}
    {% for item in items %}
    {% set job = item.job %}
    <article>
      <h3>{{ job.title }} <small>({{ item.change_type }})</small></h3>
      <dl>
        <dt>Firm</dt><dd>{{ job.firm|upper }}</dd>
        <dt>Service line</dt><dd>{{ job.service_line or "Unknown" }}</dd>
        <dt>Career level</dt><dd>{{ job.career_level or "Unknown" }}</dd>
        <dt>Locations</dt><dd>{{ job.location_summary or "Unknown" }}</dd>
        <dt>Job ID</dt><dd>{{ job.source_job_id }}</dd>
        <dt>Posted date</dt><dd>{{ job.posted_date or "Not exposed" }}</dd>
        <dt>Application deadline</dt><dd>{{ job.application_deadline or "Not exposed" }}</dd>
        <dt>First detected</dt><dd>{{ job.first_seen_at.isoformat() }}</dd>
      </dl>
      <p><a href="{{ job.detail_url }}">Official job details</a>
      {% if job.apply_url %} · <a href="{{ job.apply_url }}">Official Apply link</a>{% endif %}</p>
    </article>
    {% endfor %}
  {% else %}
    <p>None.</p>
  {% endif %}
  {% endfor %}
</body>
</html>
"""


def _location_rank(job: JobRow) -> tuple[int, str]:
    location = (job.location_summary or "").casefold()
    if "chicago" in location or "new york" in location:
        rank = 0
    elif "remote" in location or "multiple location" in location:
        rank = 2
    else:
        rank = 1
    return rank, job.title.casefold()


def write_email_preview(
    path: Path,
    *,
    new_jobs: list[JobRow],
    updated_jobs: list[JobRow],
    summary: dict[str, Any],
) -> None:
    environment = Environment(
        loader=BaseLoader(), autoescape=select_autoescape(("html", "xml"))
    )
    template = environment.from_string(TEMPLATE)
    path.parent.mkdir(parents=True, exist_ok=True)
    categorized: list[list[dict[str, Any]]] = [[], [], []]
    for change_type, jobs in (("New", new_jobs), ("Updated", updated_jobs)):
        for job in jobs:
            rank, _ = _location_rank(job)
            categorized[rank].append(
                {"job": job, "change_type": change_type}
            )
    for items in categorized:
        items.sort(key=lambda item: item["job"].title.casefold())

    path.write_text(
        template.render(
            summary=summary,
            groups=[
                ("Chicago and New York", categorized[0]),
                ("Other US locations", categorized[1]),
                ("Remote or multiple-location positions", categorized[2]),
            ],
        ),
        encoding="utf-8",
    )
