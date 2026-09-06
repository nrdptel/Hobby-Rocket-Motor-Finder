from __future__ import annotations

from abc import ABC, abstractmethod

from ..http import PoliteAsyncClient
from ..models import Listing


class EmptyScrapeError(RuntimeError):
    """A full scrape of a vendor finished cleanly and produced no listings at all.

    That is never a real state for a stocked vendor: it means the pages we walked
    weren't the pages we asked for — typically a block served with HTTP 200 (see
    ``PoliteAsyncClient``'s ``content_ok``), which no status-code check can see.
    Returning an empty list there is the worst failure mode available: the run is
    recorded ``ok`` with zero listings, ``scrape_errors`` stays empty, and the
    only trace is carry-forward quietly republishing yesterday's stock.

    Raised centrally in ``cli._async_scrape_run`` rather than per scraper, so it
    covers every vendor (including ones added later) and every way of arriving at
    nothing — discovery walking into a wall, *or* discovery succeeding and every
    product page behind it being blocked. Carry-forward is unaffected; the only
    change is that ``scrape_runs`` now carries a categorized error naming the
    vendor.
    """


class Scraper(ABC):
    """A vendor scraper. Subclasses set class-level metadata and implement scrape()."""

    slug: str
    name: str
    homepage: str
    state: str | None = None
    # Politeness defaults; overridable per-vendor.
    max_concurrent_per_host: int = 4
    min_start_interval_s: float = 0.5

    @abstractmethod
    async def scrape(
        self,
        client: PoliteAsyncClient,
        limit: int | None = None,
        only_urls: list[str] | None = None,
    ) -> list[Listing]:
        """Fetch and parse listings for AeroTech motors from this vendor.

        If ``only_urls`` is set, skip discovery and scrape only those URLs.
        If ``limit`` is set, scrape at most that many product pages.

        Tolerant of individual product-page failures: skip rather than abort.
        Network/site-wide failures should propagate so the caller can mark the
        run failed.
        """
        raise NotImplementedError
