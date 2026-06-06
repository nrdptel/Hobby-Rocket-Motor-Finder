// Stateless signed tokens for confirm / unsubscribe links — HMAC-SHA256 over a
// compact JSON payload, base64url-encoded. No DB row needed for a pending or
// unsubscribe record: the signature proves the link is genuine, and an expiry
// bounds confirm links. Uses Web Crypto (available in the Node + edge runtimes
// and in the test env).

export type TokenPayload = {
  t: "c" | "u" | "m"; // confirm | unsubscribe | manage
  e: string; // email
  m: string; // motorKey (unused/"" for manage tokens, which cover the whole email)
  x: number; // expiry, epoch seconds (0 = no expiry, used for unsubscribe)
};

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Sign a payload into a ``<body>.<sig>`` token. */
export async function signToken(secret: string, payload: TokenPayload): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, body));
  return `${body}.${sig}`;
}

/** Verify a token's signature and expiry; returns the payload or null. */
export async function verifyToken(secret: string, token: string): Promise<TokenPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: Uint8Array;
  try {
    expected = await hmac(secret, body);
  } catch {
    return null;
  }
  let given: Uint8Array;
  try {
    given = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, given)) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (payload.t !== "c" && payload.t !== "u" && payload.t !== "m") return null;
  if (typeof payload.e !== "string" || typeof payload.m !== "string") return null;
  if (typeof payload.x !== "number") return null;
  if (payload.x !== 0 && payload.x < Math.floor(Date.now() / 1000)) return null; // expired
  return payload;
}
