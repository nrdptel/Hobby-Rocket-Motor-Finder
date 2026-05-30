"""Per-vendor scrapers. Each scraper produces a list of Listing for one vendor."""

from .csrocketry import CSRocketryScraper

REGISTRY = {
    CSRocketryScraper.slug: CSRocketryScraper,
}
