from __future__ import annotations

from abc import ABC, abstractmethod

from ..http import PoliteAsyncClient
from ..models import Listing


class Scraper(ABC):
    """A vendor scraper. Subclasses set class-level metadata and implement scrape()."""

    slug: str
    name: str
    homepage: str
    state: str | None = None
    # Politeness defaults; overridable per-vendor.
    max_concurrent_per_host: int = 4
    min_start_interval_s: float = 0.5
    # Route this vendor's requests through the rotating proxy (SCRAPER_PROXY_URL)
    # when that secret is set. Opt-in per vendor: only sites that block the CI
    # data-center IP (429/403) need it; everyone else scrapes direct. No-op when
    # the secret is unset, so this is inert until a proxy is configured.
    use_proxy: bool = False

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
