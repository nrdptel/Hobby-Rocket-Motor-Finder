import { after } from "next/server";

import { alertConfig, clientIp, normalizeEmail, userMotorsKey, userRocketsKey } from "@/lib/alerts/config";
import { manageEmail, sendEmail } from "@/lib/alerts/email";
import { json } from "@/lib/alerts/http";
import { overIpLimit, rateLimitedResponse } from "@/lib/alerts/rateLimit";
import { signToken } from "@/lib/alerts/tokens";
import { smembers } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

const MANAGE_TTL_S = 3600; // magic link valid for 1 hour
const RL_MAX = 12; // manage-link requests per IP per hour

// Always the same reply so the site can't be used to test whether an address is
// subscribed (no email enumeration). A magic link is emailed only if the address
// actually has alerts; either way the caller learns nothing.
const SAME_REPLY = {
  ok: true,
  message: "If that address has any alerts, we've emailed a link to manage them.",
};

export async function POST(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "a valid email is required" }, 400);

  try {
    const ipCheck = await overIpLimit(cfg, "rl:mgr", clientIp(request), RL_MAX);
    if (ipCheck.limited) return rateLimitedResponse(ipCheck.retryAfterS);
  } catch {
    // Fail CLOSED if the store is down — consistent with the subscribe endpoints,
    // so a transient Upstash outage can't be used to fire unthrottled magic-link
    // emails (each carries a live 1h management token) at a subscriber.
    return json({ error: "We couldn't process that just now — please try again shortly." }, 429);
  }

  // Do the lookup + send AFTER responding (next/server `after`), so the response
  // latency is identical whether or not the address has alerts — closing the
  // timing oracle that an awaited-only-when-subscribed send would open. The reply
  // is always SAME_REPLY regardless.
  after(async () => {
    try {
      // Send a link if the email has ANY alerts — motor subscriptions OR
      // rocket-fit subscriptions. (Checking only motors was a bug: rocket-only
      // subscribers got no manage email even though the manage page lists them.)
      const [motors, rockets] = await Promise.all([
        smembers(cfg, userMotorsKey(email)),
        smembers(cfg, userRocketsKey(email)),
      ]);
      if (motors.length === 0 && rockets.length === 0) return;
      const token = await signToken(cfg.secret, {
        t: "m",
        e: email,
        m: "",
        x: Math.floor(Date.now() / 1000) + MANAGE_TTL_S,
      });
      const manageUrl = `${cfg.siteUrl}/api/alerts/manage?token=${encodeURIComponent(token)}`;
      const tmpl = manageEmail(manageUrl);
      await sendEmail({
        zepto: cfg.zepto,
        from: cfg.from,
        to: email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
      });
    } catch {
      // Best-effort: a transient failure just means no email; the user retries.
    }
  });

  return json(SAME_REPLY);
}
