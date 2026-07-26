import re


def normalize_whitespace(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = re.sub(r"\s+", " ", value).strip()
    return normalized or None


def normalized_identity_text(value: str) -> str:
    return (normalize_whitespace(value) or "").casefold()
