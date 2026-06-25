import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "../components/SiteHeader";

const GITHUB_DOCS =
  "https://github.com/nrdptel/Hobby-Rocket-Motor-Finder/blob/main/docs/api.md";

export const metadata: Metadata = {
  title: "Developer API — HPR Motor Finder",
  description:
    "A free, read-only JSON API of every AeroTech, Cesaroni & Loki motor we track, with per-vendor stock and pricing. No key, no rate limits, CORS-open, refreshed hourly.",
};

function Endpoint({ path, children }: { path: string; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={path}
        className="font-mono text-[13px] text-sky-700 underline decoration-sky-700/30 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400 dark:decoration-sky-400/30 dark:hover:decoration-sky-400"
      >
        GET {path}
      </a>
      <span className="text-zinc-600 dark:text-zinc-400"> — {children}</span>
    </li>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
      <code className="font-mono">{children}</code>
    </pre>
  );
}

export default function ApiPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <SiteHeader apiButton={false} />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Developer API
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        A free, read-only JSON API of everything on this site — every AeroTech, Cesaroni &amp; Loki
        motor we track, with per-vendor stock and pricing. It&apos;s plain static files on a CDN, so:
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
        <li>
          <strong>No API key, no rate limits, no cost.</strong> Use it as much as you like.
        </li>
        <li>
          <strong>CORS-open</strong> (<code className="font-mono text-xs">Access-Control-Allow-Origin: *</code>)
          — call it straight from a browser.
        </li>
        <li>
          <strong>Refreshed about hourly.</strong> Check{" "}
          <code className="font-mono text-xs">meta.json</code> for the exact{" "}
          <code className="font-mono text-xs">generated_at</code>.
        </li>
        <li>It&apos;s static JSON — no query parameters; fetch a file and filter client-side.</li>
      </ul>

      <div className="mt-8 space-y-7 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Endpoints</h2>
          <p className="mt-2">
            Base URL <code className="font-mono text-xs">https://motor.fusionspace.co/api/v1/</code>
          </p>
          <ul className="mt-3 space-y-2">
            <Endpoint path="/api/v1/meta.json">
              schema version, <code className="font-mono text-xs">generated_at</code>, counts,
              manufacturer list. Poll this to detect updates.
            </Endpoint>
            <Endpoint path="/api/v1/motors.json">
              every matched motor we have a listing for (D-class and up, matching the site).
            </Endpoint>
            <Endpoint path="/api/v1/in-stock.json">
              same shape, only motors in stock at a vendor right now.
            </Endpoint>
            <Endpoint path="/api/v1/vendors.json">
              the vendors we track, with per-vendor counts.
            </Endpoint>
            <Endpoint path="/api/v1/motors/aerotech/H128W.json">
              a single motor — slugs mirror the site&apos;s <code className="font-mono text-xs">/motor</code> URL.
            </Endpoint>
            <Endpoint path="/api/v1/openapi.json">
              OpenAPI 3.1 spec (drop into Swagger / Postman / codegen).
            </Endpoint>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Motor shape
          </h2>
          <p className="mt-2">
            Every payload carries <code className="font-mono text-xs">schema_version</code> (currently{" "}
            <code className="font-mono text-xs">1</code>) and{" "}
            <code className="font-mono text-xs">generated_at</code>. Prices are integer cents.
          </p>
          <Code>{`{
  "id": 1234,
  "path": "/api/v1/motors/aerotech/H128W.json",   // this motor's own endpoint
  "manufacturer": "AeroTech",        // | "Cesaroni Technology" | "Loki Research"
  "designation": "H128W",
  "impulse_class": "H",              // A–O
  "diameter_mm": 29,
  "total_impulse_ns": 176.2,
  "avg_thrust_n": 128,
  "burn_time_s": 1.4,
  "propellant": "White Lightning",
  "sparky": false,
  "motor_type": "reload",            // | "SU" | "hybrid"
  "case_info": "RMS-29/180",         // null for single-use
  "hazmat": "required",              // "required" | "varies" (F/G) | "none"
  "in_stock": true,
  "vendor_count": 5,                 // distinct vendors carrying it
  "in_stock_vendor_count": 3,
  "listing_count": 9,                // total listings (a vendor may list variants)
  "cheapest_in_stock": {             // pack-aware per-unit; null if none in stock
    "unit_price_cents": 3000, "currency": "USD",
    "vendor": "Wildman", "url": "https://…", "pack_size": 2
  },
  "listings": [
    {
      "vendor": "Chris' Rocket Supplies",
      "url": "https://…",            // where to buy it
      "status": "in_stock",          // | "out_of_stock" | "special_order" | "unknown"
      "price_cents": 3499,
      "unit_price_cents": 3499,      // sticker ÷ pack_size
      "pack_size": 1,
      "stock_count": null,           // units on hand, when published
      "last_seen": "2026-06-19T04:00:55Z"
    }
  ]
}`}</Code>
          <p className="mt-3">
            See the{" "}
            <a
              href={GITHUB_DOCS}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              full field reference on GitHub
            </a>{" "}
            for every field.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Examples</h2>
          <Code>{`# Cheapest in-stock H motors right now
curl -s https://motor.fusionspace.co/api/v1/in-stock.json \\
  | jq '.motors[] | select(.impulse_class=="H")
        | {designation, from: .cheapest_in_stock.unit_price_cents,
           vendor: .cheapest_in_stock.vendor}'`}</Code>
          <Code>{`// Browser — CORS is open
const res = await fetch("https://motor.fusionspace.co/api/v1/in-stock.json");
const { motors } = await res.json();
const cti54 = motors.filter(
  (m) => m.manufacturer === "Cesaroni Technology" && m.diameter_mm === 54,
);`}</Code>
        </section>

        <section>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Terms</h2>
          <p className="mt-2">
            Free to use; attribution to <strong>motor.fusionspace.co</strong> is appreciated. The data
            is aggregated from public vendor listings and{" "}
            <a
              href="https://www.thrustcurve.org"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              ThrustCurve
            </a>
            ; it&apos;s provided <strong>as-is, with no warranty</strong> — verify stock and price on
            the vendor&apos;s own page before relying on it.
          </p>
          <p className="mt-2">
            Please <strong>use this API rather than scraping the vendors directly</strong> — that&apos;s
            what it&apos;s for, and it keeps load off the shops. Cache a copy and poll{" "}
            <code className="font-mono text-xs">meta.json</code> for changes.
          </p>
          <p className="mt-2">
            There&apos;s no per-key or per-IP rate limit. Cloudflare&apos;s standard automatic abuse
            protection applies to all traffic, as it does to any site behind a CDN — normal use
            never encounters it.
          </p>
        </section>
      </div>

      <footer className="mt-10 border-t border-zinc-200 pt-5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <Link href="/" className="underline hover:text-zinc-700 dark:hover:text-zinc-300">
          ← Back to all motors
        </Link>
      </footer>
    </main>
  );
}
