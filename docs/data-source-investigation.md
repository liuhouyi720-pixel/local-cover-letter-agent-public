# Data-source investigation

Investigation date: 2026-07-24. Endpoint discovery is a development-time task;
normal monitor runs use only the reviewed URL and HTML selectors recorded here.

| firm | search_url | source_type | endpoint | request_method | pagination | job_id_field | title_field | location_field | detail_url_field | apply_url_field | requires_javascript | requires_cookie | known_limitations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PwC | `https://jobs.us.pwc.com/en/search-jobs` | Public server-rendered HTML (TalentBrew/Radancy) | Same as search URL | GET | `?p=<number>`; 15 results per page; total pages in `.pagination-total-pages` | `a.search-results-list__job-link[data-job-id]` | Link text | `li.job-location`; structured level in `li.job-level` | Link `href` | Public detail-page anchor `a.job-apply[href]` | No | No pre-existing cookie observed | Search results expose a platform job ID; the detail page also displays a different requisition-style “Job ID.” Posted date and deadline were not confirmed. Search results do not expose service line. |
| KPMG | Unknown — deferred | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Not investigated for this PwC-only local milestone. |
| EY Early Careers | Unknown — deferred | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Not investigated for this PwC-only local milestone. |
| Deloitte | Unknown — deferred | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Not investigated for this PwC-only local milestone. |

## PwC confirmed behavior

- The official search URL returns HTML containing the initial results, result
  count, and pagination. A documented public API was not identified or assumed.
- Page 2 is retrieved with
  `https://jobs.us.pwc.com/en/search-jobs?p=2`.
- Main search records expose platform job ID, title, location summary, career
  level, and official detail URL.
- Public job-detail HTML exposes category/service line, level, time type, full
  location text, description, and a direct official Workday Apply anchor.
- Posted date and application deadline are stored as `null` because they were
  not confirmed in the reviewed public HTML.
- Normal HTTP retrieval works without JavaScript, authentication, or a
  pre-existing cookie. The connector sends a clear custom User-Agent.
- The connector is appropriate only for low-frequency retrieval. It performs
  sequential requests with per-domain delay, timeout, conservative retry, HTML
  content validation, challenge detection, and unexpected-empty-result guards.

## Compliance boundary

The connector reads public search and detail pages only. It does not log in,
create accounts, fill or submit forms, bypass CAPTCHA, or follow the Apply link.
The official detail and Apply URLs are stored for manual review.
