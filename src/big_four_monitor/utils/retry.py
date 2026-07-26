class SourceError(RuntimeError):
    """Base class for a connector-level failure."""


class BlockedSourceError(SourceError):
    """The official source denied or challenged the request."""


class UnexpectedEmptyResultsError(SourceError):
    """The source unexpectedly returned no usable results."""


class InvalidSourceResponseError(SourceError):
    """The source response could not safely be parsed."""


class TransientHttpError(SourceError):
    """A temporary HTTP error that may be retried."""
