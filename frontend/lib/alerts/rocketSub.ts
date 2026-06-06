// Serialization + small helpers for rocket-fit alert subscriptions ("email me
// when anything that fits <rocket> restocks"). A subscription is just a rocket's
// fit spec + a label; it's small enough to live inside a signed token (until
// confirmed) and as a member string in two Upstash sets:
//   rocketsubs            — every confirmed rocket sub (dispatch iterates these)
//   urockets:<email>      — one email's rocket subs (the manage page lists these)
// Both sets store the IDENTICAL canonical member string so SREM works.

import type { RocketSpec } from "@/lib/rocketFit";

/** Compact rocket-sub fields. Short keys keep tokens + members small.
 *  d=diameterMm (required), c=cert, k=impulseClass, cs=caseInfo, mn=minImpulseNs,
 *  mx=maxImpulseNs, l=label, e=email. Only d is required; c/k/cs/mn/mx are
 *  optional narrowings (null = unset). c was required on subs made before this
 *  change — they still carry a cert string. */
export type RocketFields = {
  d: number;
  c: string | null;
  k: string | null;
  cs: string | null;
  mn: number | null;
  mx: number | null;
  l: string;
};

const CERTS = new Set(["mid", "l1", "l2", "l3"]);

function numOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;
}

function strOrNull(x: unknown): string | null {
  return typeof x === "string" && x ? x : null;
}

/** Validate + normalize raw subscribe input into canonical fields, or null.
 *  Only the mount diameter is required; cert/class/case/impulse-band are optional
 *  narrowings. A reload case ("RMS-38/720", "Single use") just needs to be a
 *  non-empty string; the dispatcher matches it against each motor's caseKey. */
export function normalizeRocketFields(raw: {
  diameterMm?: unknown;
  cert?: unknown;
  impulseClass?: unknown;
  caseInfo?: unknown;
  minImpulseNs?: unknown;
  maxImpulseNs?: unknown;
  label?: unknown;
}): RocketFields | null {
  const d =
    typeof raw.diameterMm === "number" && Number.isFinite(raw.diameterMm) && raw.diameterMm > 0
      ? raw.diameterMm
      : null;
  if (d == null) return null;
  // cert optional: keep only if it's a known level, else drop it.
  const certRaw = typeof raw.cert === "string" ? raw.cert : "";
  const c = CERTS.has(certRaw) ? certRaw : null;
  const k =
    typeof raw.impulseClass === "string" && /^[A-O]$/i.test(raw.impulseClass)
      ? raw.impulseClass.toUpperCase()
      : null;
  const cs =
    typeof raw.caseInfo === "string" && raw.caseInfo.trim()
      ? raw.caseInfo.trim().slice(0, 40)
      : null;
  const mn = numOrNull(raw.minImpulseNs);
  const mx = numOrNull(raw.maxImpulseNs);
  if (mn != null && mx != null && mn > mx) return null;
  let l = typeof raw.label === "string" ? raw.label.trim() : "";
  if (l.length > 80 || /[\r\n]/.test(l)) l = l.slice(0, 80).replace(/[\r\n]/g, " ");
  return { d, c, k, cs, mn, mx, l };
}

/** Canonical token payload (the `m` field of an rc/ru token): the spec, no email.
 *  Fixed key order so the same sub always serializes identically. */
export function rocketSpecField(f: RocketFields): string {
  return JSON.stringify({ d: f.d, c: f.c, k: f.k, cs: f.cs, mn: f.mn, mx: f.mx, l: f.l });
}

/** Canonical Upstash set member: the spec PLUS the email. Identical string in
 *  both `rocketsubs` and `urockets:<email>` so SREM removes from each. */
export function rocketMember(email: string, f: RocketFields): string {
  return JSON.stringify({ e: email, d: f.d, c: f.c, k: f.k, cs: f.cs, mn: f.mn, mx: f.mx, l: f.l });
}

/** Pull the canonical fields out of a parsed member/spec object, tolerating the
 *  older shape (no k/cs, c required) so subs made before this change still
 *  resolve. Returns null when the required diameter/label are missing/invalid. */
function readFields(v: unknown): RocketFields | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.d !== "number") return null;
  if (typeof o.l !== "string") return null;
  if (!(o.mn === null || o.mn === undefined || typeof o.mn === "number")) return null;
  if (!(o.mx === null || o.mx === undefined || typeof o.mx === "number")) return null;
  return {
    d: o.d,
    c: strOrNull(o.c),
    k: strOrNull(o.k),
    cs: strOrNull(o.cs),
    mn: typeof o.mn === "number" ? o.mn : null,
    mx: typeof o.mx === "number" ? o.mx : null,
    l: o.l,
  };
}

/** Parse an rc/ru token's spec field back into fields (no email). */
export function parseRocketSpecField(raw: string): RocketFields | null {
  try {
    return readFields(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Parse an Upstash member back into email + fields. */
export function parseRocketMember(raw: string): { email: string; fields: RocketFields } | null {
  try {
    const v = JSON.parse(raw);
    const fields = readFields(v);
    const email = (v as Record<string, unknown>)?.e;
    if (!fields || typeof email !== "string" || !email) return null;
    return { email, fields };
  } catch {
    return null;
  }
}

/** Fields → the RocketSpec the fit function expects. */
export function fieldsToSpec(f: RocketFields): RocketSpec {
  return {
    diameterMm: f.d,
    cert: f.c,
    impulseClass: f.k,
    caseInfo: f.cs,
    minImpulseNs: f.mn,
    maxImpulseNs: f.mx,
  };
}

const CERT_LABEL: Record<string, string> = { mid: "Mid-power", l1: "L1", l2: "L2", l3: "L3" };

/** Human one-liner for a rocket sub, e.g. "54mm · L2 · class J · Pro54-5G ·
 *  1000–5120 N·s". Only the set fields appear (diameter always). Used in emails
 *  and the manage page. */
export function describeRocketFields(f: RocketFields): string {
  const parts = [`${f.d}mm`];
  if (f.c) parts.push(CERT_LABEL[f.c] ?? f.c);
  if (f.k) parts.push(`class ${f.k}`);
  if (f.cs) parts.push(f.cs);
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
