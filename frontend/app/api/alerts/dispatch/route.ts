import { alertConfig, motorKey } from "@/lib/alerts/config";
import { restockEmail, sendEmail } from "@/lib/alerts/email";
import { signToken } from "@/lib/alerts/tokens";
import { setNxEx, smembers } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

// Don't re-alert a motor's subscribers more than once per window, even if the
// scrape flaps or the job retries. The out→in transition detection upstream is
// the primary guard; this is belt-and-suspenders.
const COOLDOWN_S = 6 * 3600;
const MAX_MOTORS = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Called by the hourly scrape with the motors that just restocked. Looks up
 * subscribers and emails them, de-duplicated by a per-motor cooldown. */
export async function POST(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearer || !constantTimeEqual(bearer, cfg.dispatchSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { motors?: Array<{ manufacturer?: unknown; designation?: unknown }> };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const motors = Array.isArray(body.motors) ? body.motors.slice(0, MAX_MOTORS) : [];

  let sent = 0;
  let notified = 0;
  for (const m of motors) {
    const manufacturer = typeof m.manufacturer === "string" ? m.manufacturer.trim() : "";
    const designation = typeof m.designation === "string" ? m.designation.trim() : "";
    if (!manufacturer || !designation) continue;
    const key = motorKey(manufacturer, designation);
    try {
      const subs = await smembers(cfg, `sub:${key}`);
      if (subs.length === 0) continue;
      // Claim the cooldown; if already claimed this window, skip (avoids dupes).
      if (!(await setNxEx(cfg, `alerted:${key}`, COOLDOWN_S))) continue;
      notified++;
      const motorUrl = `${cfg.siteUrl}/?q=${encodeURIComponent(designation)}`;
      for (const email of subs) {
        try {
          const unsubToken = await signToken(cfg.secret, { t: "u", e: email, m: key, x: 0 });
          const unsubscribeUrl = `${cfg.siteUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(
            unsubToken,
          )}`;
          const tmpl = restockEmail(designation, motorUrl, unsubscribeUrl);
          await sendEmail({
            apiKey: cfg.resendApiKey,
            from: cfg.from,
            to: email,
            subject: tmpl.subject,
            html: tmpl.html,
            text: tmpl.text,
            listUnsubscribe: unsubscribeUrl,
          });
          sent++;
        } catch {
          // Skip a single bad recipient; keep going.
        }
      }
    } catch {
      // Skip a motor whose lookup failed; keep going.
    }
  }

  return json({ ok: true, motorsRestocked: motors.length, motorsNotified: notified, emailsSent: sent });
}
