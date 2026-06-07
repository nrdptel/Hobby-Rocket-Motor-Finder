// Verify a Resend webhook signature. Resend signs webhooks with Svix:
//   signed content = `${svix-id}.${svix-timestamp}.${raw-body}`
//   signature      = base64( HMAC-SHA256( key, signed-content ) )
//   key            = base64-decode of the secret after the `whsec_` prefix
// The `svix-signature` header is a space-delimited list of `v1,<base64sig>`.
// Implemented with Web Crypto so we need no `svix` dependency.

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256(keyBytes: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export type WebhookVerifyInput = {
  secret: string; // RESEND_WEBHOOK_SECRET (whsec_...)
  id: string | null; // svix-id header
  timestamp: string | null; // svix-timestamp header (epoch seconds)
  signature: string | null; // svix-signature header
  payload: string; // RAW request body
  toleranceS?: number; // max clock skew (default 5 min)
  now?: number; // epoch seconds, injectable for tests
};

/** True only if the signature is valid AND the timestamp is within tolerance. */
export async function verifyResendWebhook(opts: WebhookVerifyInput): Promise<boolean> {
  const { secret, id, timestamp, signature, payload } = opts;
  if (!secret || !id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceS ?? 300;
  if (Math.abs(now - ts) > tolerance) return false;

  const secretB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = b64decode(secretB64);
  } catch {
    return false;
  }

  let expected: string;
  try {
    expected = b64encode(await hmacSha256(keyBytes, `${id}.${timestamp}.${payload}`));
  } catch {
    return false;
  }

  // Header may carry multiple versioned signatures; any match passes.
  for (const part of signature.split(" ")) {
    const comma = part.indexOf(",");
    const sig = comma >= 0 ? part.slice(comma + 1) : part;
    if (timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

/** Pull the recipient address(es) out of a Resend webhook event payload.
 * `data.to` is an array of addresses (or a single string in some events). */
export function recipientsFromEvent(event: unknown): string[] {
  if (typeof event !== "object" || event === null) return [];
  const data = (event as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return [];
  const to = (data as { to?: unknown }).to;
  if (Array.isArray(to)) return to.filter((x): x is string => typeof x === "string");
  if (typeof to === "string") return [to];
  return [];
}

/** Should this event cause an unsubscribe? Always for complaints; for bounces
 * only when it's NOT clearly transient/soft (permanent bounces are the
 * reputation risk; a temporary "mailbox full" shouldn't drop the subscriber). */
export function isRemovableEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== "string") return false;
  if (type === "email.complained") return true;
  if (type === "email.bounced") {
    const data = (event as { data?: { bounce?: { type?: unknown } } }).data;
    const bt = data?.bounce?.type;
    if (typeof bt === "string" && /transient|soft|temporary/i.test(bt)) return false;
    return true;
  }
  return false;
}
