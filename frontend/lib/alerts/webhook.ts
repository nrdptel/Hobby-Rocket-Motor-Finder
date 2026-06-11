// Verify a ZeptoMail webhook and pull bounce/complaint recipients out of its
// payload. ZeptoMail signs each webhook with a `producer-signature` header:
//   producer-signature: ts=<epoch-ms>;s=<base64 sig>;s-algorithm=HmacSHA256
// The signature is HMAC-SHA256 over the timestamp joined to the raw body, keyed
// with the secret you configure on the Agent's webhook. Implemented with Web
// Crypto so we need no extra dependency.
//
// NOTE: ZeptoMail publishes the header format but not the exact signed-content
// concatenation. `signedContent()` encodes our assumption (`<ts>.<rawBody>`) in
// one place; if the first real delivery fails verification, adjust it there.
// Verification fails CLOSED, so a wrong guess only no-ops the scrub — it never
// lets an unverified request through.

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

/** The exact string fed to HMAC-SHA256. Isolated so the one ZeptoMail-specific
 * assumption lives in a single place (see file header). */
function signedContent(ts: string, payload: string): string {
  return `${ts}.${payload}`;
}

/** Parse `ts=…;s=…;s-algorithm=…` into a map. Tolerant of ordering/whitespace. */
function parseProducerSignature(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export type WebhookVerifyInput = {
  secret: string; // the webhook auth key configured on the ZeptoMail Agent
  signatureHeader: string | null; // raw `producer-signature` header value
  payload: string; // RAW request body
  toleranceS?: number; // max clock skew (default 5 min)
  now?: number; // epoch seconds, injectable for tests
};

/** True only if the signature is valid AND the timestamp is within tolerance. */
export async function verifyZeptoWebhook(opts: WebhookVerifyInput): Promise<boolean> {
  const { secret, signatureHeader, payload } = opts;
  if (!secret || !signatureHeader) return false;

  const parts = parseProducerSignature(signatureHeader);
  const tsRaw = parts.ts;
  const sig = parts.s;
  if (!tsRaw || !sig) return false;

  // ZeptoMail's `ts` is epoch milliseconds; compare in seconds.
  const tsMs = Number(tsRaw);
  if (!Number.isFinite(tsMs)) return false;
  const ts = Math.floor(tsMs / 1000);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceS ?? 300;
  if (Math.abs(now - ts) > tolerance) return false;

  let expected: string;
  try {
    expected = b64encode(
      await hmacSha256(new TextEncoder().encode(secret), signedContent(tsRaw, payload)),
    );
  } catch {
    return false;
  }
  return timingSafeEqual(sig, expected);
}

/** Walk an unknown value and collect every `email_address.address` string under
 * it. ZeptoMail nests the recipient at
 * `event_message[].email_info.to[].email_address.address`, but the docs are
 * inconsistent about whether intermediate nodes are arrays or objects, so a
 * tolerant recursive scan beats hard-coding one shape. */
function collectAddresses(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const v of node) collectAddresses(v, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;
  // `email_address: { address }` (the recipient shape) → take the address.
  const ea = obj.email_address;
  if (ea && typeof ea === "object") {
    collectAddresses(ea, out);
  }
  if (typeof obj.address === "string" && obj.address.includes("@")) {
    out.add(obj.address);
  }
  // Recurse only into the carriers that hold recipients, so we don't sweep up
  // the From/bounce-return addresses (which live under different keys).
  for (const key of ["event_message", "email_info", "to"]) {
    if (key in obj) collectAddresses(obj[key], out);
  }
}

/** Pull recipient address(es) out of a ZeptoMail bounce/complaint event. */
export function recipientsFromEvent(event: unknown): string[] {
  const out = new Set<string>();
  collectAddresses(event, out);
  return [...out];
}

/** Should this event cause an unsubscribe? Hard bounces and spam complaints
 * (feedback-loop) are the reputation risk → remove. Soft/transient bounces are
 * temporary (e.g. mailbox full) → keep the subscriber. */
export function isRemovableEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const name = (event as { event_name?: unknown }).event_name;
  if (typeof name !== "string") return false;
  const n = name.toLowerCase();
  if (n.includes("soft")) return false; // soft bounce → transient, keep
  if (n.includes("hard") && n.includes("bounce")) return true;
  if (n.includes("feedback") || n.includes("complaint") || n.includes("spam")) return true;
  return false;
}
