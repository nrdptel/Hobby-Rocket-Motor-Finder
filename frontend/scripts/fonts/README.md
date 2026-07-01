# Vendored fonts (share-card rendering)

`scripts/gen-og.mjs` renders the Open Graph / share cards with `next/og`, which
embeds fonts into the PNG at build time. next/og ships only **Geist Regular** as
its built-in default, so a heavier title (to match the site's `font-semibold`
`<h1>`) needs the actual weight embedded. These are vendored so the build never
depends on a network font fetch.

- `Geist-Regular.ttf` — Geist, weight 400 (taglines / specs / domain)
- `Geist-SemiBold.ttf` — Geist, weight 600 (default-card product name — matches the site h1 — and the per-motor stock line)
- `Geist-Bold.ttf` — Geist, weight 700 (per-motor hero designation)

**Geist** is © Vercel, licensed under the SIL Open Font License 1.1 (OFL) — free
to use, embed, and redistribute. Source: Google Fonts (`fonts.google.com/specimen/Geist`),
Geist v5. Full license: <https://github.com/vercel/geist-font/blob/main/LICENSE.TXT>.
