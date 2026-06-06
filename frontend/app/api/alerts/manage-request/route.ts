import { alertConfig, normalizeEmail, userMotorsKey } from "@/lib/alerts/config";
import { manageEmail, sendEmail } from "@/lib/alerts/email";
import { signToken } from "@/lib/alerts/tokens";
import { incrWithTtl, smembers } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

const MANAGE_TTL_S = 3600; // magic link valid for 1 hour
const RL_MAX = 12; // manage-link requests per IP per hour

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  try {
    const count = await incrWithTtl(cfg, `rl:mgr:${ip}`, 3600);
    if (count > RL_MAX) return json({ error: "rate limited; try again later" }, 429);
  } catch {
    // rate-limit store down — fall through; the work below is cheap + idempotent.
  }

  try {
    const motors = await smembers(cfg, userMotorsKey(email));
    if (motors.length > 0) {
      const token = await signToken(cfg.secret, {
        t: "m",
        e: email,
        m: "",
        x: Math.floor(Date.now() / 1000) + MANAGE_TTL_S,
      });
      const manageUrl = `${cfg.siteUrl}/api/alerts/manage?token=${encodeURIComponent(token)}`;
      const tmpl = manageEmail(manageUrl);
      await sendEmail({
        apiKey: cfg.resendApiKey,
        from: cfg.from,
        to: email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
      });
    }
  } catch {
    // Swallow: still return the same reply so failures don't leak existence
    // either. (A transient send failure just means no email; user can retry.)
  }

  return json(SAME_REPLY);
}
