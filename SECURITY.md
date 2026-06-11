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

In scope: the web app and its API routes (`frontend/app/api/alerts/*`), the
token/auth handling, and the scrape/snapshot pipeline.

Out of scope: third-party services this project integrates with (ZeptoMail,
Upstash, Vercel) — report those to the respective vendor. Stale or incorrect
stock/price data is a data-quality bug, not a security issue — please use the
bug-report template for that.

## Known advisories

`npm audit` reports a **moderate** advisory in `postcss`, pulled in transitively
by Next.js. It concerns PostCSS's CSS *stringify* output and only affects
**build-time** processing of CSS. This project builds only its own first-party
Tailwind CSS (no untrusted CSS is processed), so there is no runtime exposure.
There is no fix available in the current Next.js major; it will clear when a
Next.js release bundles a patched PostCSS. Tracked, not a release blocker.

