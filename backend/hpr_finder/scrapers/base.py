from __future__ import annotations

from abc import ABC, abstractmethod

from ..http import PoliteClient
from ..models import Listing


class Scraper(ABC):
    """A vendor scraper. Subclasses set class-level metadata and implement scrape()."""

    slug: str
    name: str
    homepage: str
    state: str | None = None
    min_request_interval_s: float = 30.0

    @abstractmethod
    def scrape(self, client: PoliteClient, limit: int | None = None) -> list[Listing]:
        """Fetch and parse listings for AeroTech motors from this vendor.

        If `limit` is set, scrape at most that many product pages (useful for
        smoke tests). Tolerant of individual product-page failures: skip rather
        than abort. Network/site-wide failures should propagate so the caller
        can mark the run failed.
        """
        raise NotImplementedError
