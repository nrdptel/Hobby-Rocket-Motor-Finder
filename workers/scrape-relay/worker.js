// Cloudflare Worker — a narrow, authenticated fetch-relay for the HPR Motor Finder
// scraper (backend/hpr_finder/http.py, the "relay" fail-over tier).
//
// Why: some vendors (Shopify stores, erockets) 429/403 the GitHub Actions
// data-center IP *and* a flagged residential-proxy pool — but they return 200 to a
// clean-reputation IP. Cloudflare's egress is one such clean IP, and Workers are
// free (100k requests/day). The scraper, when a vendor blocks it, re-fetches through
// this Worker: `GET https://<worker>/?url=<origin url>` with a shared-secret header.
// The Worker fetches the origin and passes its status + body straight back, so the
// scraper parses it exactly as if it had come direct.
//
// It is NOT an open proxy: it requires the shared secret AND the target host must be
// on the allow-list below (the project's known vendor domains). The origin still
// sees our honest, self-identifying User-Agent (forwarded via X-Relay-UA).

const ALLOWED_HOSTS = new Set([
  "aerotech-rocketry.com",
  "www.buyrocketmotors.com",
  "newcenturyrocketry.shop",
  "wildmanrocketry.com",
  "www.erockets.biz",
  "cart.amwprox.com",
  "lokiresearch.com",
  "performancehobbies.com",
  "www.balsamachining.com",
  "www.csrocketry.com",
  "www.moto-joe.com",
  "www.siriusrocketry.biz",
]);

export default {
  async fetch(request, env) {
    // Only GET is ever needed by the scraper.
    if (request.method !== "GET") {
      return new Response("method not allowed", { status: 405 });
    }

    // Shared-secret auth so this can't be used as an open proxy. Compare against the
    // Worker secret RELAY_SECRET (set via `wrangler secret put RELAY_SECRET`).
    const secret = env.RELAY_SECRET;
    if (!secret || request.headers.get("X-Relay-Auth") !== secret) {
      return new Response("forbidden", { status: 403 });
    }

    const target = new URL(request.url).searchParams.get("url");
    if (!target) return new Response("missing url param", { status: 400 });

    let t;
    try {
      t = new URL(target);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (t.protocol !== "https:") {
      return new Response("https targets only", { status: 400 });
    }
    if (!ALLOWED_HOSTS.has(t.hostname)) {
      return new Response("host not allowed: " + t.hostname, { status: 403 });
    }

    // Forward our honest, self-identifying UA to the origin (the scraper sends it as
    // X-Relay-UA). Defence-in-depth default keeps it identifiable if that's missing.
    const ua =
      request.headers.get("X-Relay-UA") ||
      "HPRMotorFinder/0.1 (+https://github.com/nrdptel/Hobby-Rocket-Motor-Finder)";

    let originResp;
    try {
      originResp = await fetch(t.toString(), {
        method: "GET",
        headers: { "User-Agent": ua, Accept: "*/*" },
        redirect: "follow",
        // Never serve a cached scrape response.
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch (e) {
      // A relay-side failure returns 502 (retryable) so the scraper escalates to its
      // next fail-over tier (the proxy) instead of treating it as a hard error.
      return new Response("relay fetch failed: " + e, { status: 502 });
    }

    // Pass the origin's status + body straight back. Echo Content-Type and
    // Retry-After so the scraper's parsing and back-off honoring still work.
    const headers = new Headers();
    const ct = originResp.headers.get("Content-Type");
    if (ct) headers.set("Content-Type", ct);
    const ra = originResp.headers.get("Retry-After");
    if (ra) headers.set("Retry-After", ra);
    return new Response(originResp.body, { status: originResp.status, headers });
  },
};
