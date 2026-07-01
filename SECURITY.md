# Security Policy

This is a hobby project, but security reports are very welcome.

## Reporting a vulnerability

Please **report privately** — do not open a public issue for security problems.

Use GitHub's private vulnerability reporting:
[**Report a vulnerability**](https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/security/advisories/new)

Please include steps to reproduce and the impact you observed. I'll acknowledge
as soon as I can and work on a fix; since this is a side project, response times
are best-effort.

## Scope

In scope: the web app and its alert API (the Cloudflare Pages Functions in
`frontend/functions/api/alerts/*` over the shared `frontend/lib/alerts/*`), the
token/auth handling, and the scrape/snapshot pipeline.

Out of scope: third-party services this project integrates with (ZeptoMail,
Upstash, Cloudflare) — report those to the respective vendor. Stale or incorrect
stock/price data is a data-quality bug, not a security issue — please use the
bug-report template for that.

## Known advisories

`npm audit` reports a **moderate** advisory in `postcss`, pulled in transitively
by Next.js. It concerns PostCSS's CSS *stringify* output and only affects
**build-time** processing of CSS. This project builds only its own first-party
Tailwind CSS (no untrusted CSS is processed), so there is no runtime exposure.
There is no fix available in the current Next.js major; it will clear when a
Next.js release bundles a patched PostCSS. Tracked, not a release blocker.

`npm audit` also reports a **high** advisory in `vite` (`server.fs.deny` bypass
on Windows alternate paths; a Windows-only NTLMv2-hash disclosure in
`launch-editor`), pulled in transitively by **`vitest`** — the unit-test runner.
`vite` never serves this site (it's a static export built by Next); it only backs
local/CI unit tests, which never expose a dev server, and the flaws are
Windows-only while CI runs on Linux — so there is no production or CI exposure.
The patched line (`vite` 8.1.x) is within `vitest`'s supported range but
truncates large-file `readFileSync` at 512 KB in the test environment, which
breaks a snapshot-parity test, so the bump is held until that regression clears.
Tracked, not a release blocker.

