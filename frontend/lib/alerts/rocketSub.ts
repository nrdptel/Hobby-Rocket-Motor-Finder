// Serialization + small helpers for rocket-fit alert subscriptions ("email me
// when anything that fits <rocket> restocks"). A subscription is just a rocket's
// fit spec + a label; it's small enough to live inside a signed token (until
// confirmed) and as a member string in two Upstash sets:
//   rocketsubs            — every confirmed rocket sub (dispatch iterates these)
//   urockets:<email>      — one email's rocket subs (the manage page lists these)
// Both sets store the IDENTICAL canonical member string so SREM works.

import type { RocketSpec } from "@/lib/rocketFit";

/** Compact rocket-sub fields. Short keys keep tokens + members small.
 *  d=diameterMm, c=cert, mn=minImpulseNs, mx=maxImpulseNs, l=label, e=email. */
export type RocketFields = {
  d: number;
  c: string;
  mn: number | null;
  mx: number | null;
  l: string;
};

const CERTS = new Set(["mid", "l1", "l2", "l3"]);

function numOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
}

/** Validate + normalize raw subscribe input into canonical fields, or null. */
export function normalizeRocketFields(raw: {
  diameterMm?: unknown;
  cert?: unknown;
  minImpulseNs?: unknown;
  maxImpulseNs?: unknown;
  label?: unknown;
}): RocketFields | null {
  const d =
    typeof raw.diameterMm === "number" && Number.isFinite(raw.diameterMm) && raw.diameterMm > 0
      ? raw.diameterMm
      : null;
  if (d == null) return null;
  const c = typeof raw.cert === "string" ? raw.cert : "";
  if (!CERTS.has(c)) return null;
  const mn = numOrNull(raw.minImpulseNs);
  const mx = numOrNull(raw.maxImpulseNs);
  if (mn != null && mx != null && mn > mx) return null;
  let l = typeof raw.label === "string" ? raw.label.trim() : "";
  if (l.length > 80 || /[\r\n]/.test(l)) l = l.slice(0, 80).replace(/[\r\n]/g, " ");
  return { d, c, mn, mx, l };
}

/** Canonical token payload (the `m` field of an rc/ru token): the spec, no email.
 *  Fixed key order so the same sub always serializes identically. */
export function rocketSpecField(f: RocketFields): string {
  return JSON.stringify({ d: f.d, c: f.c, mn: f.mn, mx: f.mx, l: f.l });
}

/** Canonical Upstash set member: the spec PLUS the email. Identical string in
 *  both `rocketsubs` and `urockets:<email>` so SREM removes from each. */
export function rocketMember(email: string, f: RocketFields): string {
  return JSON.stringify({ e: email, d: f.d, c: f.c, mn: f.mn, mx: f.mx, l: f.l });
}

function isFields(v: unknown): v is RocketFields & { e?: string } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.d === "number" &&
    typeof o.c === "string" &&
    (o.mn === null || typeof o.mn === "number") &&
    (o.mx === null || typeof o.mx === "number") &&
    typeof o.l === "string"
  );
}

/** Parse an rc/ru token's spec field back into fields (no email). */
export function parseRocketSpecField(raw: string): RocketFields | null {
  try {
    const v = JSON.parse(raw);
    if (!isFields(v)) return null;
    return { d: v.d, c: v.c, mn: v.mn, mx: v.mx, l: v.l };
  } catch {
    return null;
  }
}

/** Parse an Upstash member back into email + fields. */
export function parseRocketMember(raw: string): { email: string; fields: RocketFields } | null {
  try {
    const v = JSON.parse(raw);
    if (!isFields(v) || typeof v.e !== "string" || !v.e) return null;
    return { email: v.e, fields: { d: v.d, c: v.c, mn: v.mn, mx: v.mx, l: v.l } };
  } catch {
    return null;
  }
}

/** Fields → the RocketSpec the fit function expects. */
export function fieldsToSpec(f: RocketFields): RocketSpec {
  return { diameterMm: f.d, cert: f.c, minImpulseNs: f.mn, maxImpulseNs: f.mx };
}

const CERT_LABEL: Record<string, string> = { mid: "Mid-power", l1: "L1", l2: "L2", l3: "L3" };

/** Human one-liner for a rocket sub, e.g. "54mm · L2 · 1000–5120 N·s". Used in
 *  emails and the manage page. */
export function describeRocketFields(f: RocketFields): string {
  const parts = [`${f.d}mm`, CERT_LABEL[f.c] ?? f.c];
  if (f.mn != null && f.mx != null) parts.push(`${f.mn}–${f.mx} N·s`);
  else if (f.mn != null) parts.push(`≥${f.mn} N·s`);
  else if (f.mx != null) parts.push(`≤${f.mx} N·s`);
  return parts.join(" · ");
}

/** Display name for a rocket sub: its label, or the spec if unlabeled. */
export function rocketDisplayName(f: RocketFields): string {
  return f.l || describeRocketFields(f);
}

/** Short stable hash of a string (djb2 → hex). Used to keep the per-(rocket,
 *  motor) alert-cooldown Redis keys short. */
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
