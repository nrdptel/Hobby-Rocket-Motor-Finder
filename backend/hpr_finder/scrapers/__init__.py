"""Per-vendor scrapers. Each scraper produces a list of Listing for one vendor."""

from .amw import AMWScraper
from .buyrocketmotors import BuyRocketMotorsScraper
from .csrocketry import CSRocketryScraper
from .wildman import WildmanScraper

REGISTRY = {
    CSRocketryScraper.slug: CSRocketryScraper,
    BuyRocketMotorsScraper.slug: BuyRocketMotorsScraper,
    WildmanScraper.slug: WildmanScraper,
    AMWScraper.slug: AMWScraper,
}
