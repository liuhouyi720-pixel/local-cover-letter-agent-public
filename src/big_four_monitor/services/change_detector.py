def has_meaningful_change(
    previous_content_hash: str | None, current_content_hash: str
) -> bool:
    """Compare hashes built only from the specification's meaningful fields."""
    return previous_content_hash != current_content_hash
