import { alertConfig, normalizeEmail } from "@/lib/alerts/config";
import { removeAllForEmail } from "@/lib/alerts/store";
import { isRemovableEvent, recipientsFromEvent, verifyResendWebhook } from "@/lib/alerts/webhook";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Resend bounce/complaint webhook. On a hard bounce or a spam complaint, scrub
// the address from every subscription so it's never emailed again — protecting
// sender reputation. Inert (404-ish 503) unless RESEND_WEBHOOK_SECRET is set, so
// the feature stays optional and a fork without it is unaffected.
export async function POST(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return json({ error: "alerts not configured" }, 503);
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook not configured" }, 503);

  // Signature is over the RAW body, so read text (not request.json()).
  const payload = await request.text();
  const ok = await verifyResendWebhook({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    payload,
  });
  if (!ok) return json({ error: "invalid signature" }, 401);

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  // Always 200 on a verified event (so Resend doesn't retry), even if it's an
  // event type we don't act on.
  if (!isRemovableEvent(event)) return json({ ok: true, ignored: true });

  let removed = 0;
  for (const raw of recipientsFromEvent(event)) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    try {
      const r = await removeAllForEmail(cfg, email);
      removed += r.motors + r.rockets;
    } catch {
      // best-effort; Resend will not retry on our 200, which is fine — a still-
      // subscribed dead address just bounces again and re-fires this webhook.
    }
  }
  return json({ ok: true, removed });
}
