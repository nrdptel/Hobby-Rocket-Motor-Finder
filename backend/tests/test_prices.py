"""Tests for the shared scraper price->cents helper."""
from hpr_finder.scrapers.prices import price_to_cents


def test_plain_numeric_strings():
    assert price_to_cents("33.14") == 3314
    assert price_to_cents("600.09") == 60009
    assert price_to_cents("5") == 500


def test_numeric_types():
    assert price_to_cents(33.14) == 3314
    assert price_to_cents(42) == 4200


def test_strips_currency_symbols_and_thousands_commas():
    assert price_to_cents("$1,234.50") == 123450
    assert price_to_cents("1,234") == 123400
    assert price_to_cents(" $42.00 ") == 4200


def test_rounds_to_nearest_cent():
    # float math: 19.99 * 100 must not truncate to 1998
    assert price_to_cents("19.99") == 1999
    assert price_to_cents("0.1") == 10


def test_unparseable_returns_none():
    assert price_to_cents(None) is None
    assert price_to_cents("") is None
    assert price_to_cents("not-a-price") is None
    assert price_to_cents("$") is None
