from big_four_monitor.parsing.locations import parse_location
from big_four_monitor.parsing.urls import canonicalize_url


def test_url_canonicalization() -> None:
    assert canonicalize_url(
        "/job/1?source=careers&b=2#apply", "https://JOBS.EXAMPLE.COM"
    ) == "https://jobs.example.com/job/1?b=2&source=careers"


def test_location_normalization() -> None:
    parsed = parse_location("Chicago, Illinois")
    assert parsed["city"] == "Chicago"
    assert parsed["state"] == "IL"
    assert parsed["country"] == "United States"
