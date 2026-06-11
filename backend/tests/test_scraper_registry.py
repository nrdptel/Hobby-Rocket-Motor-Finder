"""Structural contract for the scraper REGISTRY.

Catches the silent maintainability mistakes — adding a scraper module but
forgetting to register it (so the vendor is never scraped), a slug typo/collision
(so two vendors clobber each other), or missing metadata — at test time instead
of in production, where they'd surface only as a quietly-missing vendor.
"""
from __future__ import annotations

import importlib
import pkgutil

import hpr_finder.scrapers as scrapers_pkg
from hpr_finder.scrapers import REGISTRY
from hpr_finder.scrapers.base import Scraper

# Modules in the scrapers package that aren't vendor scrapers.
_NON_SCRAPER_MODULES = {"base", "prices"}


def _defined_scraper_classes() -> list[type[Scraper]]:
    """Every concrete Scraper subclass DEFINED in a scrapers/*.py module (not
    merely imported into it)."""
    found: list[type[Scraper]] = []
    for info in pkgutil.iter_modules(scrapers_pkg.__path__):
        if info.name in _NON_SCRAPER_MODULES:
            continue
        mod = importlib.import_module(f"hpr_finder.scrapers.{info.name}")
        for obj in vars(mod).values():
            if (
                isinstance(obj, type)
                and issubclass(obj, Scraper)
                and obj is not Scraper
                and obj.__module__ == mod.__name__  # defined here, not imported
            ):
                found.append(obj)
    return found


def test_every_scraper_module_is_registered():
    defined = set(_defined_scraper_classes())
    registered = set(REGISTRY.values())
    # Exact 1:1 — catches both an unregistered new scraper AND a stale REGISTRY
    # entry whose module was removed. (Also fails loudly if the introspection
    # ever finds nothing, rather than passing vacuously.)
    assert defined, "introspection found no scraper classes — check the package layout"
    assert defined == registered, (
        f"REGISTRY out of sync — only-defined: {[c.__name__ for c in defined - registered]}, "
        f"only-registered: {[c.__name__ for c in registered - defined]}"
    )


def test_registry_keys_match_slugs():
    for key, cls in REGISTRY.items():
        assert key == cls.slug, f"REGISTRY key {key!r} != {cls.__name__}.slug {cls.slug!r}"


def test_slugs_are_unique():
    slugs = [cls.slug for cls in REGISTRY.values()]
    assert len(slugs) == len(set(slugs)), f"duplicate slug(s): {slugs}"


def test_each_scraper_has_required_metadata():
    for cls in REGISTRY.values():
        for field in ("slug", "name", "homepage"):
            val = getattr(cls, field, None)
            assert isinstance(val, str) and val, f"{cls.__name__}.{field} missing/empty"


def test_each_scraper_implements_scrape():
    # A subclass that didn't override the abstract scrape() can't be instantiated;
    # a no-arg constructor is also part of the contract (the CLI does `cls()`).
    for cls in REGISTRY.values():
        instance = cls()
        assert instance.scrape.__func__ is not Scraper.scrape, (
            f"{cls.__name__} does not override scrape()"
        )


def test_registry_is_non_empty():
    assert REGISTRY, "no scrapers registered"
