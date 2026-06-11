import { alertConfig, clientIp, normalizeEmail } from "@/lib/alerts/config";
import { rocketConfirmEmail, sendEmail } from "@/lib/alerts/email";
import { manageLink } from "@/lib/alerts/manageLink";
import {
  confirmRecentlySent,
  overGlobalConfirmCap,
  overIpLimit,
  releaseConfirmCooldown,
  utcHour,
} from "@/lib/alerts/rateLimit";
import {
  describeRocketFields,
  normalizeRocketFields,
  rocketDisplayName,
  rocketSpecField,
} from "@/lib/alerts/rocketSub";
import { signToken } from "@/lib/alerts/tokens";

export const dynamic = "force-dynamic";

const CONFIRM_TTL_S = 24 * 3600; // confirm links expire in 24h
const RL_MAX = 12; // subscribe requests per IP per hour

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// "Email me when anything that fits this rocket restocks." Takes the rocket's
// fit spec (diameter required; optional cert, impulse class, reload case, and
// impulse band) and a label; double-opt-in like the per-motor subscribe.
export async function POST(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const fields = normalizeRocketFields(body);
  if (!email) return json({ error: "a valid email is required" }, 400);
  if (!fields) return json({ error: "a valid rocket (motor-mount diameter) is required" }, 400);

  // Per-IP hourly cap, global hourly cap, and a per-recipient cooldown; all fail
  // CLOSED if the store is down so a flaky Upstash can't be used to bypass them.
  try {
    if (await overIpLimit(cfg, "rl:sub", clientIp(request), RL_MAX)) {
      return json({ error: "rate limited; try again later" }, 429);
    }
    // Per-recipient cooldown BEFORE the global cap, so a request we're going to
    // suppress (no email) doesn't burn the global hourly budget — the global cap
    // then counts only would-be sends. Suppressed → SAME success message so we
    // never reveal subscription state.
    if (await confirmRecentlySent(cfg, email)) {
      return json({ ok: true, message: "Check your email to confirm." });
    }
    if (await overGlobalConfirmCap(cfg, utcHour())) {
      // Over the global cap after claiming the cooldown → release it so this
      // address isn't locked out of retrying once the window resets.
      await releaseConfirmCooldown(cfg, email);
      return json({ error: "rate limited; try again later" }, 429);
    }
  } catch {
    return json({ error: "rate limited; try again later" }, 429);
  }

  const token = await signToken(cfg.secret, {
    t: "rc",
    e: email,
    m: rocketSpecField(fields),
    x: Math.floor(Date.now() / 1000) + CONFIRM_TTL_S,
  });
  const confirmUrl = `${cfg.siteUrl}/api/alerts/confirm?token=${encodeURIComponent(token)}`;
  const tmpl = rocketConfirmEmail(
    rocketDisplayName(fields),
    describeRocketFields(fields),
    confirmUrl,
    await manageLink(cfg, email),
  );

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
    await releaseConfirmCooldown(cfg, email);
    return json({ error: "could not send confirmation email" }, 502);
  }

  return json({ ok: true, message: "Check your email to confirm." });
}
