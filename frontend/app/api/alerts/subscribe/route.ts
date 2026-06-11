import { alertConfig, clientIp, motorKey, normalizeEmail } from "@/lib/alerts/config";
import { sendEmail, confirmEmail } from "@/lib/alerts/email";
import { manageLink } from "@/lib/alerts/manageLink";
import {
  confirmRecentlySent,
  overGlobalConfirmCap,
  overIpLimit,
  releaseConfirmCooldown,
  utcHour,
} from "@/lib/alerts/rateLimit";
import { signToken } from "@/lib/alerts/tokens";

export const dynamic = "force-dynamic";

const CONFIRM_TTL_S = 24 * 3600; // confirm links expire in 24h
const RL_MAX = 12; // subscribe requests per IP per hour

function shortField(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 80 || /[\r\n]/.test(v)) return null;
  return v;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  let body: { email?: unknown; manufacturer?: unknown; designation?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const manufacturer = shortField(body.manufacturer);
  const designation = shortField(body.designation);
  if (!email || !manufacturer || !designation) {
    return json({ error: "email, manufacturer and designation are required" }, 400);
  }
  // The cooldown is per-(email, motor), so compute the motorKey up front.
  const key = motorKey(manufacturer, designation);

  // Per-IP hourly cap, a global hourly cap, and a per-recipient cooldown. All
  // fail CLOSED (no email) if the store is down, so a flaky Upstash can't be used
  // to bypass the limits and email-bomb / burn the send quota.
  try {
    if (await overIpLimit(cfg, "rl:sub", clientIp(request), RL_MAX)) {
      return json({ error: "rate limited; try again later" }, 429);
    }
    // Per-recipient cooldown BEFORE the global cap, so a request we're going to
    // suppress (no email) doesn't burn the global hourly budget — the global cap
    // then counts only would-be sends. Suppressed → SAME success message so we
    // never reveal subscription state.
    if (await confirmRecentlySent(cfg, email, key)) {
      return json({ ok: true, message: "Check your email to confirm." });
    }
    if (await overGlobalConfirmCap(cfg, utcHour())) {
      // Over the global cap after claiming the cooldown → release it so this
      // address isn't locked out of retrying once the window resets.
      await releaseConfirmCooldown(cfg, email, key);
      return json({ error: "rate limited; try again later" }, 429);
    }
  } catch {
    return json({ error: "rate limited; try again later" }, 429);
  }

  const token = await signToken(cfg.secret, {
    t: "c",
    e: email,
    m: key,
    x: Math.floor(Date.now() / 1000) + CONFIRM_TTL_S,
  });
  const confirmUrl = `${cfg.siteUrl}/api/alerts/confirm?token=${encodeURIComponent(token)}`;
  const tmpl = confirmEmail(designation, confirmUrl, await manageLink(cfg, email));

  try {
    await sendEmail({
      zepto: cfg.zepto,
      from: cfg.from,
      to: email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
    });
  } catch {
    // Send failed → release the per-recipient cooldown so a transient error
    // doesn't lock this address out of retrying for the full window.
    await releaseConfirmCooldown(cfg, email, key);
    return json({ error: "could not send confirmation email" }, 502);
  }

  // Don't reveal whether the email already existed; always the same response.
  return json({ ok: true, message: "Check your email to confirm." });
}
