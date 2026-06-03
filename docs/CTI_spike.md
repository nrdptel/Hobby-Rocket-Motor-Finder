# Cesaroni (CTI) coverage spike — Phase 0

Read-only spike to define the Cesaroni designation grammar and per-vendor coverage
before writing any matching code. Mirrors the original AeroTech spike. Nothing here
touches the live scrape pipeline.

Data pulled 2026-06-02 from ThrustCurve's public search API and vendor product feeds,
using the project's polite User-Agent.

## CTI canonical grammar (ThrustCurve)

286 Cesaroni records (`availability: available`). The designation scheme is
**fundamentally different from AeroTech** — there is **no propellant letter inside the
designation**. Instead:

```
designation  =  <totImpulseNs><class><avgThrustN>-<maxDelay>A
                 e.g.  234I445-16A ,  24E22-13A ,  1750K650-16A
commonName   =  <class><avgThrustN>
                 e.g.  I445 ,  E22 ,  K650
```

- The leading number is total impulse in N·s (rounded). Vendors almost never use this
  leading-number form — they list the `commonName` (e.g. `I445`).
- Propellant is a separate **flavor**, carried in `propInfo`, NOT encoded in the
  designation. This is the opposite of AeroTech (`H242T` bakes the `T` = Blue Thunder
  into the designation).
- Trailing `-NNA`: `NN` = the longest listed delay, `A` = adjustable (CTI delays are
  always field-adjustable via the Pro hardware, so this is effectively constant).
- `delays` is a full CSV of available delays, e.g. `4,6,8,10,13`.

## The match key (solved)

Because the vendor-facing key is `commonName` (no propellant letter), `commonName`
alone is ambiguous — 6 commonNames map to >1 motor (different total impulse / flavor),
e.g. `F36` = `41F36-11A` Smoky Sam **and** `51F36-14A` Blue Streak.

Uniqueness measured across all 286 records:

| Key | Collisions |
|---|---|
| `commonName` | 6 |
| `(commonName, propInfo)` | **1** — only `H123 Skidmark` (29mm vs 38mm) |
| `(commonName, propInfo, diameter)` | **0 — fully unique** |

**Match strategy for CTI:** extract `commonName` from the title, infer the flavor →
`propInfo`, match on `(commonName, propInfo)`; if still ambiguous (the lone H123 case),
disambiguate by `diameter`, which is recoverable from the Pro-size in the vendor's URL
/ category (Pro24→24mm, Pro29→29, Pro38→38, Pro54→54, Pro75→75, Pro98→98).

CTI diameters present: 24, 29, 38, 54, 75, 98, 132, 161 mm.

## Flavor set (the disambiguation vocabulary)

15 distinct `propInfo` values, by frequency: Classic, White Thunder, Blue Streak,
White, Skidmark, Red Lightning, Smoky Sam, Vmax, Imax, Green3, Mellow, C-Star, Pink,
plus two Dual-Thrust variants (`Classic/Dual Thrust`, `Imax/Dual Thrust`).

**Needs an alias table** — vendor spelling drifts from ThrustCurve's canonical form.
Confirmed: csrocketry URL slug `smokey-sam` vs ThrustCurve `Smoky Sam`. Build the table
the same way as AeroTech's `PROPELLANT_NAME_TO_INFO`, longest-phrase-first.

## Vendor title formats — they differ, and flavors get abbreviated

Two confirmed formats so far:

```
csrocketry:   Cesaroni I170-14A Classic Rocket Motor
              └commonName -delay+A  └flavor   └boilerplate
              (clean JSON-LD Product block, same bad-escape quirk the
               csrocketry scraper already tolerates)

Wildman:      N5600-CTI White Thunder        M1675-CTI  Pink (double space)
              └commonName └literal "-CTI"  └flavor (often ABBREVIATED, no delay on big motors)
```

**Critical Phase-2 finding: vendors abbreviate the flavor names**, and differently from
each other. The alias table must be robust and longest-match-first (so `White Thunder`
beats `White`). Confirmed Wildman abbreviations → ThrustCurve `propInfo`:

| Vendor text | ThrustCurve `propInfo` |
|---|---|
| `Green` | Green3 |
| `Red` | Red Lightning |
| `Blue` | Blue Streak |
| `Skid Mark` | Skidmark |
| `C Star` | C-Star |
| `smokey-sam` (csrocketry slug) | Smoky Sam |
| `White` (bare) vs `White Thunder` | White vs White Thunder — **distinct flavors**, order matters |

So the **scraper machinery is reusable** — CTI only needs new discovery URLs + the CTI
designation extractor + this alias table.

### Match-rate validation (the proof the approach works)

Simulated matching Wildman's real CTI titles against the ThrustCurve CTI catalog using
the alias table + `(commonName, flavor)` key:

```
254 motor-ish Wildman CTI titles (hardware filtered out)
→ 253 matched  (99%)
→   0 ambiguous (flavor pinned every collision)
→   1 miss      (I297 Skidmark — not in TC "available" subset)
```

This validates the whole approach end-to-end before any code is written. Same 99%+ bar
the AeroTech matcher already hits.

## Per-vendor CTI coverage (revised after a full-catalog Wildman pull)

| Vendor | CTI reloads? | Notes |
|---|---|---|
| **csrocketry** | ✅ **447 URLs, clean JSON-LD** | Organized by Pro-size → grain count. Title uses `commonName` (`I445`). **Start here**, mirrors AeroTech build order. |
| **Wildman** | ✅ **~250 reloads** (347 CTI products, ~93 hardware) | **Primary source, not marginal** — earlier "mostly hardware" call was a 3-page sampling artifact; full feed is 8 pages / ~1930 products. Title uses `commonName` + abbreviated flavor (`N5600-CTI White Thunder`). Must filter hardware (`P<dia>-*` closures/cases/spacers). |
| AMW | ⚠️ **yes (~60), but HARD** | Uses a **hardware-SKU** scheme `P<dia>-<grains>G-<flavor>` (e.g. `P38-5G-WT`) with **no commonName**. Matchable only via ThrustCurve `caseInfo` (`Pro38-5G`) + flavor — but `(caseInfo, propInfo)` has **19 two-way collisions**, plus heavy hardware noise (cases/closures/spacers/nosecones) and Pro130/Pro150 research motors absent from ThrustCurve. **Lowest confidence — do last, or skip.** |
| Sirius | ❌ **none** | Sitemap 0 `cesaroni` hits; no manufacturer page (slug guesses 301→home); search empty. Skip for CTI. |
| BuyRocketMotors | ❌ **none** | Vendor field has AeroTech, Kozmo, LOC, Quest — zero Cesaroni. Skip for CTI. |

### Two distinct CTI match paths (Phase 2 must support both)

1. **commonName path** (csrocketry, Wildman): title → `commonName` + flavor → `(commonName, propInfo[, diameter])`. Validated at 99% on Wildman.
2. **caseInfo path** (AMW only): SKU `P38-5G-WT` → `(caseInfo="Pro38-5G", propInfo="White Thunder")`. Imperfect — 19 case/flavor pairs are 2-way ambiguous (the second key, total impulse or grain-geometry variant, isn't in AMW's SKU), so AMW will have a residual unmatched/ambiguous tail. Acceptable since AMW lands as the optional last vendor.

## Implications for the remaining phases

- **Phase 2 (normalize/match):** add `extract_cti_designation` (commonName + flavor +
  delay) and a CTI flavor alias table; `find_motor_id` dispatches on manufacturer. The
  CTI match key is `(commonName, propInfo[, diameter])`, NOT the AeroTech transform chain.
  **Gotcha:** ThrustCurve returns the manufacturer name as `"Cesaroni Technology"` (the
  search *query* is `"Cesaroni"`, but the records carry the long form). So the catalog
  stores `manufacturer = "Cesaroni Technology"`, and `find_motor_id` must query with that
  exact string for CTI listings. (AeroTech needs no such care — query and record both say
  `"AeroTech"`.)
- **Phase 3 order:** csrocketry → Wildman → (AMW optional/last, hard). csrocketry and
  Wildman are strong primary sources (~447, ~250) on the clean commonName path. AMW needs
  the separate caseInfo match path and tolerates a residual ambiguous tail. **Drop Sirius
  and BuyRocketMotors from CTI scope — neither carries Cesaroni.**
- Pass the Pro-size diameter from the discovery URL into the listing so the lone H123
  ambiguity resolves without guessing.
</content>
</invoke>
