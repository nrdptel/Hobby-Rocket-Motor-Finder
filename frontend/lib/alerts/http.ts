// Small HTTP helpers shared by the alert API routes — a JSON Response builder
// and the dispatch-bearer auth check, kept in one place so they don't drift
// (the auth check in particular is security-sensitive and was copy-pasted).

import type { AlertConfig } from "./config";

/** JSON Response with the right content-type. */
export function json(body: unknown, status = 200): Response {
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

/** True if the request carries the dispatch bearer secret. Guards the CI-only
 * dispatch + backfill endpoints; compared in constant time. */
export function hasDispatchBearer(request: Request, cfg: AlertConfig): boolean {
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return bearer !== "" && constantTimeEqual(bearer, cfg.dispatchSecret);
}
