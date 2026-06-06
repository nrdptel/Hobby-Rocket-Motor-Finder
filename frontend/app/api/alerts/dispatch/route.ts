import { alertConfig, motorKey, rocketSubsKey, subKey } from "@/lib/alerts/config";
import { restockEmail, rocketRestockEmail, sendEmail } from "@/lib/alerts/email";
import { manageLink } from "@/lib/alerts/manageLink";
import { motorFitsRocket } from "@/lib/rocketFit";
import {
  fieldsToSpec,
  parseRocketMember,
  rocketDisplayName,
  rocketSpecField,
  shortHash,
} from "@/lib/alerts/rocketSub";
import { signToken } from "@/lib/alerts/tokens";
import { del, setNxEx, smembers } from "@/lib/alerts/upstash";

type RestockMotor = {
  manufacturer: string;
  designation: string;
  diameter_mm: number;
  impulse_class: string;
  total_impulse_ns: number | null;
};

export const dynamic = "force-dynamic";
// Sends are sequential and a throttled batch can hit the 429 retry's backoff;
// give the function headroom so it isn't cut off mid-batch (which would skip the
// cooldown rollback below and strand those motors).
export const maxDuration = 60;

// Don't re-alert a motor's subscribers more than once per window, even if the
// scrape flaps or the job retries. The out→in transition detection upstream is
// the primary guard; this is belt-and-suspenders.
const COOLDOWN_S = 6 * 3600;
const MAX_MOTORS = 1000;

function json(body: unknown, status = 200): Response {
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

/** Called by the hourly scrape with the motors that just restocked. Looks up
 * subscribers and emails them, de-duplicated by a per-motor cooldown. */
export async function POST(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearer || !constantTimeEqual(bearer, cfg.dispatchSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { motors?: Array<Record<string, unknown>> };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const motors = Array.isArray(body.motors) ? body.motors.slice(0, MAX_MOTORS) : [];

  let sent = 0;
  let notified = 0;
  for (const m of motors) {
    const manufacturer = typeof m.manufacturer === "string" ? m.manufacturer.trim() : "";
    const designation = typeof m.designation === "string" ? m.designation.trim() : "";
    if (!manufacturer || !designation) continue;
    const key = motorKey(manufacturer, designation);
    try {
      const subs = await smembers(cfg, subKey(key));
      if (subs.length === 0) continue;
      // Claim the cooldown; if already claimed this window, skip (avoids dupes).
      if (!(await setNxEx(cfg, `alerted:${key}`, COOLDOWN_S))) continue;
      notified++;
      const motorUrl = `${cfg.siteUrl}/?q=${encodeURIComponent(designation)}`;
      let sentForMotor = 0;
      for (const email of subs) {
        try {
          const unsubToken = await signToken(cfg.secret, { t: "u", e: email, m: key, x: 0 });
          const unsubscribeUrl = `${cfg.siteUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(
            unsubToken,
          )}`;
          const tmpl = restockEmail(designation, motorUrl, unsubscribeUrl, await manageLink(cfg, email));
          await sendEmail({
            apiKey: cfg.resendApiKey,
            from: cfg.from,
            to: email,
            subject: tmpl.subject,
            html: tmpl.html,
            text: tmpl.text,
            listUnsubscribe: unsubscribeUrl,
          });
          sent++;
          sentForMotor++;
        } catch {
          // Skip a single bad recipient; keep going.
        }
      }
      // If NOT ONE recipient got the email, release the cooldown claim. Note
      // this only enables a retry when the fresh snapshot ALSO fails to commit
      // this run (so the next run still diffs the same out→in transition); on
      // the normal path the committed snapshot means the restock won't be
      // re-detected, so a total send outage remains a rare best-effort miss.
      // A successful send keeps the claim, preserving the dedupe guarantee.
      if (sentForMotor === 0) {
        try {
          await del(cfg, `alerted:${key}`);
        } catch {
          /* best-effort */
        }
      }
    } catch {
      // Skip a motor whose lookup failed; keep going.
    }
  }

  // --- Rocket-fit alerts: "email me when anything that fits my rocket restocks"
  // For each confirmed rocket sub, find which restocked motors fit it and send
  // one digest email, de-duped by a per-(rocket, motor) cooldown.
  let rocketsNotified = 0;
  let rocketEmailsSent = 0;
  const restocked: RestockMotor[] = [];
  for (const m of motors) {
    const manufacturer = typeof m.manufacturer === "string" ? m.manufacturer.trim() : "";
    const designation = typeof m.designation === "string" ? m.designation.trim() : "";
    const diameter = typeof m.diameter_mm === "number" ? m.diameter_mm : Number(m.diameter_mm);
    if (!manufacturer || !designation || !Number.isFinite(diameter)) continue;
    restocked.push({
      manufacturer,
      designation,
      diameter_mm: diameter,
      impulse_class: typeof m.impulse_class === "string" ? m.impulse_class : "",
      total_impulse_ns: typeof m.total_impulse_ns === "number" ? m.total_impulse_ns : null,
    });
  }

  if (restocked.length > 0) {
    let members: string[] = [];
    try {
      members = await smembers(cfg, rocketSubsKey());
    } catch {
      members = [];
    }
    for (const raw of members) {
      const parsed = parseRocketMember(raw);
      if (!parsed) continue;
      const spec = fieldsToSpec(parsed.fields);
      const fits = restocked.filter((mo) => motorFitsRocket(spec, mo));
      if (fits.length === 0) continue;

      // Claim a per-(sub, motor) cooldown; skip any already alerted this window.
      const h = shortHash(raw);
      const fresh: RestockMotor[] = [];
      const claimedKeys: string[] = [];
      for (const mo of fits) {
        const ck = `alerted-r:${h}:${motorKey(mo.manufacturer, mo.designation)}`;
        try {
          if (await setNxEx(cfg, ck, COOLDOWN_S)) {
            fresh.push(mo);
            claimedKeys.push(ck);
          }
        } catch {
          // cooldown store down — skip (fail closed) to avoid dupe spam.
        }
      }
      if (fresh.length === 0) continue;

      rocketsNotified++;
      try {
        const unsubToken = await signToken(cfg.secret, {
          t: "ru",
          e: parsed.email,
          m: rocketSpecField(parsed.fields),
          x: 0,
        });
        const unsubscribeUrl = `${cfg.siteUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(
          unsubToken,
        )}`;
        const items = fresh.map((mo) => ({
          designation: mo.designation,
          manufacturer: mo.manufacturer,
          url: `${cfg.siteUrl}/?q=${encodeURIComponent(mo.designation)}`,
        }));
        const tmpl = rocketRestockEmail(
          rocketDisplayName(parsed.fields),
          items,
          unsubscribeUrl,
          await manageLink(cfg, parsed.email),
        );
        await sendEmail({
          apiKey: cfg.resendApiKey,
          from: cfg.from,
          to: parsed.email,
          subject: tmpl.subject,
          html: tmpl.html,
          text: tmpl.text,
          listUnsubscribe: unsubscribeUrl,
        });
        rocketEmailsSent++;
      } catch {
        // The digest send failed — release the cooldown claims. As with the
        // per-motor path this only enables a retry if the fresh snapshot also
        // fails to commit this run; otherwise the restock isn't re-detected next
        // run. Best-effort.
        for (const ck of claimedKeys) {
          try {
            await del(cfg, ck);
          } catch {
            /* best-effort */
          }
        }
      }
    }
  }

  return json({
    ok: true,
    motorsRestocked: motors.length,
    motorsNotified: notified,
    emailsSent: sent,
    rocketsNotified,
    rocketEmailsSent,
  });
}
