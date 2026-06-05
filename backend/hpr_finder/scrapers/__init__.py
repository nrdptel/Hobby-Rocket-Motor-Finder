"""Per-vendor scrapers. Each scraper produces a list of Listing for one vendor."""

from .amw import AMWScraper
from .buyrocketmotors import BuyRocketMotorsScraper
from .csrocketry import CSRocketryScraper
from .loki import LokiScraper
from .sirius import SiriusScraper
from .wildman import WildmanScraper

REGISTRY = {
    CSRocketryScraper.slug: CSRocketryScraper,
    BuyRocketMotorsScraper.slug: BuyRocketMotorsScraper,
    WildmanScraper.slug: WildmanScraper,
    AMWScraper.slug: AMWScraper,
    SiriusScraper.slug: SiriusScraper,
    LokiScraper.slug: LokiScraper,
}
