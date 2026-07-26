from abc import ABC, abstractmethod

from ..models import JobPosting, SearchRecord


class BaseConnector(ABC):
    firm_name: str
    source_name: str
    pages_fetched: int = 0

    @abstractmethod
    async def fetch_search_records(self) -> list[SearchRecord]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_job_detail(self, record: SearchRecord) -> JobPosting:
        raise NotImplementedError
