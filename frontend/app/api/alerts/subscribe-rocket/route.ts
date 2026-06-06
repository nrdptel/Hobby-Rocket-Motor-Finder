import { alertConfig, normalizeEmail } from "@/lib/alerts/config";
import { rocketConfirmEmail, sendEmail } from "@/lib/alerts/email";
import {
  describeRocketFields,
  normalizeRocketFields,
  rocketDisplayName,
  rocketSpecField,
} from "@/lib/alerts/rocketSub";
import { signToken } from "@/lib/alerts/tokens";
import { incrWithTtl } from "@/lib/alerts/upstash";

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
// fit spec (diameter + cert + optional impulse band) and a label; double-opt-in
// like the per-motor subscribe.
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
  if (!fields) return json({ error: "a valid rocket (diameter + cert) is required" }, 400);

  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  try {
    const count = await incrWithTtl(cfg, `rl:sub:${ip}`, 3600);
    if (count > RL_MAX) return json({ error: "rate limited; try again later" }, 429);
  } catch {
    // rate-limit store down — fall through to send.
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
    `${cfg.siteUrl}/alerts`,
  );

  try {
    await sendEmail({
      apiKey: cfg.resendApiKey,
      from: cfg.from,
      to: email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
    });
  } catch {
    return json({ error: "could not send confirmation email" }, 502);
  }

  return json({ ok: true, message: "Check your email to confirm." });
}
