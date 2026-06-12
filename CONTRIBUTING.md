# Contributing

Thanks for your interest! This is a personal hobby project, but issues and PRs
are welcome — especially vendor parser fixes and new vendors.

## Project layout

- `backend/` — Python scraper, catalog matcher, snapshot/history builders, and
  the `hpr` CLI (Typer). See `backend/README.md`.
- `frontend/` — Next.js UI + the email-alert API routes. This is a customized
  Next.js build, so check `node_modules/next/dist/docs/` before relying on
  framework behavior from memory.
- `data/` — generated snapshots/history and the ThrustCurve catalog caches.

## Setup

```bash
# Backend
cd backend
pip install -e '.[dev]'

# Frontend
cd ../frontend
npm install
npm run dev   # http://localhost:3000 — uses snapshot.example.json out of the box
```

Email alerts are optional and gated on env vars — see `frontend/.env.example`
and `docs/email-alerts.md`.

## Checks (run before opening a PR)

These mirror CI (`.github/workflows/test.yml`); all must pass.

```bash
# Backend
cd backend
ruff check .                       # lint (CI gate)
pytest -q                          # unit tests
pytest -q --cov --cov-fail-under=70  # coverage gate
# Optional but kept clean: npx pyright hpr_finder

# Frontend
cd ../frontend
npm test            # vitest unit tests
npm run build       # also type-checks (CI gate; tsconfig has noUnusedLocals/Params)
npm run test:e2e    # Playwright (incl. the axe accessibility audit)
```

## Adding a vendor

See [Adding a vendor](README.md#adding-a-vendor) in the README. In short: add a
scraper under `backend/hpr_finder/scrapers/`, register it, capture an HTML
fixture, and write a parse test.

## Testing scrapers — golden fixtures

Scraper tests are **golden-fixture** tests: each captures a real vendor page
under `backend/tests/fixtures/`, and the parse tests assert the exact values
extracted from it (designations, prices, stock counts). Those asserted numbers
are tied to the frozen capture **on purpose**.

- When you **refresh a fixture** (re-capture a vendor page because their markup
  changed), expect the asserted values to change too — re-verify them against
  the new capture rather than assuming the old numbers still hold.
- The `scrape()` orchestration tests drive the async methods through a small
  in-memory fake HTTP client that routes by URL/params. If you change a
  scraper's URL scheme or pagination, update that scraper test's fake client to
  match.

Keep the two kinds separate: pure `parse_*` functions take HTML/dicts and return
`Listing`s (test them directly with fixtures); `scrape()` only adds the network
orchestration (test it with the fake client). This keeps the bulk of coverage on
pure, network-free logic.

## Conventions

- Match the surrounding code's style, naming, and comment density.
- Keep commits focused; describe the *why* in the message.
