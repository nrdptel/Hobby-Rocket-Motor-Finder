"""Per-vendor scrapers. Each scraper produces a list of Listing for one vendor."""

from .aerotechdirect import AeroTechDirectScraper
from .amw import AMWScraper
from .buyrocketmotors import BuyRocketMotorsScraper
from .csrocketry import CSRocketryScraper
from .loki import LokiScraper
from .performancehobbies import PerformanceHobbiesScraper
from .sirius import SiriusScraper
from .wildman import WildmanScraper

REGISTRY = {
    CSRocketryScraper.slug: CSRocketryScraper,
    BuyRocketMotorsScraper.slug: BuyRocketMotorsScraper,
    WildmanScraper.slug: WildmanScraper,
    AMWScraper.slug: AMWScraper,
    SiriusScraper.slug: SiriusScraper,
    LokiScraper.slug: LokiScraper,
    PerformanceHobbiesScraper.slug: PerformanceHobbiesScraper,
    AeroTechDirectScraper.slug: AeroTechDirectScraper,
}
