// Portable alert HTTP handlers — the bodies that used to live in the Next
// `app/api/alerts/**/route.ts` route handlers. They were moved here, parameterized
// over an env source, so they can run as Cloudflare Pages Functions (which the
// static-export migration requires — static export forbids route handlers) AND
// be exercised by the Node/vitest lifecycle test, without depending on Next.
//
// Each handler takes (request, env) — env is `process.env` on Node and
// `context.env` in a Pages Function — and returns a standard Web `Response`. They
// use only fetch (Upstash + ZeptoMail), Web Crypto (via tokens/webhook), and the
// request body, so they're portable across both runtimes. The thin
// `functions/api/alerts/*` wrappers just adapt the Pages-Function context to
// these calls.

import {
  alertConfig,
  clientIp,
  motorKey,
  normalizeEmail,
  rocketSubsKey,
  subKey,
  userMotorsKey,
  userRocketsKey,
  type EnvSource,
} from "./config";
import { sendEmail, confirmEmail, manageEmail, rocketConfirmEmail } from "./email";
import {
  EmailQuotaError,
  restockEmail,
  rocketRestockEmail,
} from "./email";
import { hasDispatchBearer, json } from "./http";
import { manageLink } from "./manageLink";
import {
  confirmRecentlySent,
  overGlobalConfirmCap,
  overIpLimit,
  rateLimitedResponse,
  releaseConfirmCooldown,
  utcHour,
} from "./rateLimit";
import { designationFromKey, managePage, resultPage } from "./resultPage";
import { motorFitsRocket } from "../rocketFit";
import {
  describeRocketFields,
  fieldsToSpec,
  normalizeRocketFields,
  parseRocketMember,
  parseRocketSpecField,
  rocketDisplayName,
  rocketMember,
  rocketSpecField,
  shortHash,
} from "./rocketSub";
import { removeAllForEmail } from "./store";
import { signToken, verifyToken } from "./tokens";
import { del, sadd, scanKeys, setNxEx, smembers, srem } from "./upstash";
import { isRemovableEvent, recipientsFromEvent, verifyZeptoWebhook } from "./webhook";

const CONFIRM_TTL_S = 24 * 3600; // confirm links expire in 24h
const SUBSCRIBE_RL_MAX = 12; // subscribe requests per IP per hour
const MANAGE_TTL_S = 3600; // manage magic link valid for 1 hour
const MANAGE_RL_MAX = 12; // manage-link requests per IP per hour

function shortField(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 80 || /[\r\n]/.test(v)) return null;
  return v;
}

// --- subscribe (per-motor) -------------------------------------------------
export async function handleSubscribe(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  let body: { email?: unknown; manufacturer?: unknown; designation?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const manufacturer = shortField(body.manufacturer);
  const designation = shortField(body.designation);
  if (!email || !manufacturer || !designation) {
    return json({ error: "email, manufacturer and designation are required" }, 400);
  }
  const key = motorKey(manufacturer, designation);

  try {
    const ipCheck = await overIpLimit(cfg, "rl:sub", clientIp(request), SUBSCRIBE_RL_MAX);
    if (ipCheck.limited) {
      return rateLimitedResponse(ipCheck.retryAfterS, "Any confirmations already sent are in your inbox.");
    }
    if (await confirmRecentlySent(cfg, email, key)) {
      return json({ ok: true, message: "Check your email to confirm." });
    }
    const capCheck = await overGlobalConfirmCap(cfg, utcHour());
    if (capCheck.limited) {
      await releaseConfirmCooldown(cfg, email, key);
      return rateLimitedResponse(capCheck.retryAfterS);
    }
  } catch {
    return json({ error: "We couldn't set up your alert just now — please try again shortly." }, 429);
  }

  const token = await signToken(cfg.secret, {
    t: "c",
    e: email,
    m: key,
    x: Math.floor(Date.now() / 1000) + CONFIRM_TTL_S,
  });
  const confirmUrl = `${cfg.siteUrl}/api/alerts/confirm?token=${encodeURIComponent(token)}`;
  const tmpl = confirmEmail(designation, confirmUrl, await manageLink(cfg, email));

  try {
    await sendEmail({
      zepto: cfg.zepto,
      from: cfg.from,
      to: email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
    });
  } catch {
    await releaseConfirmCooldown(cfg, email, key);
    return json({ error: "could not send confirmation email" }, 502);
  }

  return json({ ok: true, message: "Check your email to confirm." });
}

// --- subscribe-rocket ("anything that fits my rocket") ---------------------
export async function handleSubscribeRocket(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
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
  if (!fields) return json({ error: "a valid rocket (motor-mount diameter) is required" }, 400);
  const specField = rocketSpecField(fields);

  try {
    const ipCheck = await overIpLimit(cfg, "rl:sub", clientIp(request), SUBSCRIBE_RL_MAX);
    if (ipCheck.limited) {
      return rateLimitedResponse(ipCheck.retryAfterS, "Any confirmations already sent are in your inbox.");
    }
    if (await confirmRecentlySent(cfg, email, specField)) {
      return json({ ok: true, message: "Check your email to confirm." });
    }
    const capCheck = await overGlobalConfirmCap(cfg, utcHour());
    if (capCheck.limited) {
      await releaseConfirmCooldown(cfg, email, specField);
      return rateLimitedResponse(capCheck.retryAfterS);
    }
  } catch {
    return json({ error: "We couldn't set up your alert just now — please try again shortly." }, 429);
  }

  const token = await signToken(cfg.secret, {
    t: "rc",
    e: email,
    m: specField,
    x: Math.floor(Date.now() / 1000) + CONFIRM_TTL_S,
  });
  const confirmUrl = `${cfg.siteUrl}/api/alerts/confirm?token=${encodeURIComponent(token)}`;
  const tmpl = rocketConfirmEmail(
    rocketDisplayName(fields),
    describeRocketFields(fields),
    confirmUrl,
    await manageLink(cfg, email),
  );

  try {
    await sendEmail({
      zepto: cfg.zepto,
      from: cfg.from,
      to: email,
      subject: tmpl.subject,
      html: tmpl.html,
      text: tmpl.text,
    });
  } catch {
    await releaseConfirmCooldown(cfg, email, specField);
    return json({ error: "could not send confirmation email" }, 502);
  }

  return json({ ok: true, message: "Check your email to confirm." });
}

// --- confirm ---------------------------------------------------------------
export async function handleConfirm(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return resultPage("Alerts unavailable", "Email alerts aren't configured.", "/", 503);

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = await verifyToken(cfg.secret, token);
  if (!payload || (payload.t !== "c" && payload.t !== "rc")) {
    return resultPage(
      "Link expired",
      "This confirmation link is invalid or has expired. Try subscribing again.",
      cfg.siteUrl,
      400,
    );
  }

  if (payload.t === "rc") {
    const fields = parseRocketSpecField(payload.m);
    if (!fields) {
      return resultPage("Link expired", "This confirmation link isn't valid.", cfg.siteUrl, 400);
    }
    const member = rocketMember(payload.e, fields);
    try {
      await sadd(cfg, rocketSubsKey(), member);
      await sadd(cfg, userRocketsKey(payload.e), member);
    } catch {
      return resultPage(
        "Something went wrong",
        "We couldn't confirm your subscription just now. Please try again later.",
        cfg.siteUrl,
        500,
      );
    }
    return resultPage(
      "You're subscribed ✓",
      `We'll email ${payload.e} when any motor that fits ${rocketDisplayName(fields)} comes back in stock. You can unsubscribe from any alert email.`,
      cfg.siteUrl,
    );
  }

  try {
    await sadd(cfg, subKey(payload.m), payload.e);
    await sadd(cfg, userMotorsKey(payload.e), payload.m);
  } catch {
    return resultPage(
      "Something went wrong",
      "We couldn't confirm your subscription just now. Please try again later.",
      cfg.siteUrl,
      500,
    );
  }

  const designation = designationFromKey(payload.m);
  return resultPage(
    "You're subscribed ✓",
    `We'll email ${payload.e} when ${designation} comes back in stock. You can unsubscribe from any alert email.`,
    cfg.siteUrl,
  );
}

// --- unsubscribe (GET = email click; POST = RFC 8058 one-click) ------------
export async function handleUnsubscribe(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return resultPage("Alerts unavailable", "Email alerts aren't configured.", "/", 503);

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = await verifyToken(cfg.secret, token);
  if (!payload || (payload.t !== "u" && payload.t !== "ru")) {
    return resultPage("Invalid link", "This unsubscribe link isn't valid.", cfg.siteUrl, 400);
  }

  if (payload.t === "ru") {
    const fields = parseRocketSpecField(payload.m);
    if (!fields) {
      return resultPage("Invalid link", "This unsubscribe link isn't valid.", cfg.siteUrl, 400);
    }
    const member = rocketMember(payload.e, fields);
    try {
      await srem(cfg, rocketSubsKey(), member);
      await srem(cfg, userRocketsKey(payload.e), member);
    } catch {
      return resultPage(
        "Something went wrong",
        "We couldn't process the unsubscribe just now. Please try again later.",
        cfg.siteUrl,
        500,
      );
    }
    return resultPage(
      "Unsubscribed",
      `${payload.e} will no longer get restock alerts for motors that fit ${rocketDisplayName(fields)}.`,
      cfg.siteUrl,
    );
  }

  try {
    await srem(cfg, subKey(payload.m), payload.e);
    await srem(cfg, userMotorsKey(payload.e), payload.m);
  } catch {
    return resultPage(
      "Something went wrong",
      "We couldn't process the unsubscribe just now. Please try again later.",
      cfg.siteUrl,
      500,
    );
  }

  const designation = designationFromKey(payload.m);
  return resultPage(
    "Unsubscribed",
    `${payload.e} will no longer get ${designation} restock alerts.`,
    cfg.siteUrl,
  );
}

// --- manage (view + act) ---------------------------------------------------
export async function handleManage(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return resultPage("Alerts unavailable", "Email alerts aren't configured.", "/", 503);

  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const payload = await verifyToken(cfg.secret, token);
  if (!payload || payload.t !== "m") {
    return resultPage(
      "Link expired",
      "This manage link is invalid or has expired. Request a fresh one from the site.",
      cfg.siteUrl,
      400,
    );
  }

  const email = payload.e;
  const unsub = url.searchParams.get("unsub");
  const unsubrocket = url.searchParams.get("unsubrocket");
  const unsuball = url.searchParams.get("unsuball");

  try {
    if (unsuball) {
      await removeAllForEmail(cfg, email);
    } else if (unsub) {
      await srem(cfg, subKey(unsub), email);
      await srem(cfg, userMotorsKey(email), unsub);
    } else if (unsubrocket) {
      await srem(cfg, rocketSubsKey(), unsubrocket);
      await srem(cfg, userRocketsKey(email), unsubrocket);
    }

    const remaining = await smembers(cfg, userMotorsKey(email));
    const rocketMembers = await smembers(cfg, userRocketsKey(email));
    const rockets = rocketMembers
      .map((mem) => {
        const parsed = parseRocketMember(mem);
        if (!parsed) return null;
        return {
          member: mem,
          name: rocketDisplayName(parsed.fields),
          desc: describeRocketFields(parsed.fields),
        };
      })
      .filter((r): r is { member: string; name: string; desc: string } => r !== null);
    return managePage(email, remaining, rockets, token, cfg.siteUrl);
  } catch {
    return resultPage(
      "Something went wrong",
      "We couldn't load your alerts just now. Please try the link again in a moment.",
      cfg.siteUrl,
      500,
    );
  }
}

// --- manage-request (magic-link email) -------------------------------------
// `waitUntil` defers the lookup+send so response latency is identical whether or
// not the address has alerts (closing the timing oracle). On Next this was
// next/server `after`; a Pages Function passes context.waitUntil. If neither is
// available we fall back to awaiting (still correct, just observable latency).
export async function handleManageRequest(
  request: Request,
  env: EnvSource,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "a valid email is required" }, 400);

  try {
    const ipCheck = await overIpLimit(cfg, "rl:mgr", clientIp(request), MANAGE_RL_MAX);
    if (ipCheck.limited) return rateLimitedResponse(ipCheck.retryAfterS);
  } catch {
    return json({ error: "We couldn't process that just now — please try again shortly." }, 429);
  }

  const SAME_REPLY = {
    ok: true,
    message: "If that address has any alerts, we've emailed a link to manage them.",
  };

  const work = async () => {
    try {
      const [motors, rockets] = await Promise.all([
        smembers(cfg, userMotorsKey(email)),
        smembers(cfg, userRocketsKey(email)),
      ]);
      if (motors.length === 0 && rockets.length === 0) return;
      const token = await signToken(cfg.secret, {
        t: "m",
        e: email,
        m: "",
        x: Math.floor(Date.now() / 1000) + MANAGE_TTL_S,
      });
      const manageUrl = `${cfg.siteUrl}/api/alerts/manage?token=${encodeURIComponent(token)}`;
      const tmpl = manageEmail(manageUrl);
      await sendEmail({
        zepto: cfg.zepto,
        from: cfg.from,
        to: email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
      });
    } catch {
      // Best-effort: a transient failure just means no email; the user retries.
    }
  };

  if (waitUntil) waitUntil(work());
  else await work();

  return json(SAME_REPLY);
}

// --- dispatch (CI scrape → emails) -----------------------------------------
type RestockMotor = {
  manufacturer: string;
  designation: string;
  diameter_mm: number;
  impulse_class: string;
  total_impulse_ns: number | null;
  case_info: string | null;
  motor_type: string | null;
};

const COOLDOWN_S = 6 * 3600;
const MAX_MOTORS = 1000;

export async function handleDispatch(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  if (!hasDispatchBearer(request, cfg)) {
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
  let quotaExhausted = false;
  for (const m of motors) {
    if (quotaExhausted) break;
    const manufacturer = typeof m.manufacturer === "string" ? m.manufacturer.trim() : "";
    const designation = typeof m.designation === "string" ? m.designation.trim() : "";
    if (!manufacturer || !designation) continue;
    const key = motorKey(manufacturer, designation);
    const firstAvailable = m.first_available === true;
    try {
      const subs = await smembers(cfg, subKey(key));
      if (subs.length === 0) continue;
      if (!(await setNxEx(cfg, `alerted:${key}`, COOLDOWN_S))) continue;
      notified++;
      const motorUrl = `${cfg.siteUrl}/?q=${encodeURIComponent(designation)}`;
      let sentForMotor = 0;
      for (const email of subs) {
        if (quotaExhausted) break;
        try {
          const unsubToken = await signToken(cfg.secret, { t: "u", e: email, m: key, x: 0 });
          const unsubscribeUrl = `${cfg.siteUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(
            unsubToken,
          )}`;
          const tmpl = restockEmail(
            designation,
            motorUrl,
            unsubscribeUrl,
            await manageLink(cfg, email),
            firstAvailable,
          );
          await sendEmail({
            zepto: cfg.zepto,
            from: cfg.from,
            to: email,
            subject: tmpl.subject,
            html: tmpl.html,
            text: tmpl.text,
            listUnsubscribe: unsubscribeUrl,
          });
          sent++;
          sentForMotor++;
        } catch (e) {
          if (e instanceof EmailQuotaError) {
            quotaExhausted = true;
            break;
          }
        }
      }
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
      case_info: typeof m.case_info === "string" ? m.case_info : null,
      motor_type: typeof m.motor_type === "string" ? m.motor_type : null,
    });
  }

  if (restocked.length > 0 && !quotaExhausted) {
    let members: string[] = [];
    try {
      members = await smembers(cfg, rocketSubsKey());
    } catch {
      members = [];
    }
    for (const raw of members) {
      if (quotaExhausted) break;
      const parsed = parseRocketMember(raw);
      if (!parsed) continue;
      const spec = fieldsToSpec(parsed.fields);
      const fits = restocked.filter((mo) => motorFitsRocket(spec, mo));
      if (fits.length === 0) continue;

      const hsh = shortHash(raw);
      const fresh: RestockMotor[] = [];
      const claimedKeys: string[] = [];
      for (const mo of fits) {
        const ck = `alerted-r:${hsh}:${motorKey(mo.manufacturer, mo.designation)}`;
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
          zepto: cfg.zepto,
          from: cfg.from,
          to: parsed.email,
          subject: tmpl.subject,
          html: tmpl.html,
          text: tmpl.text,
          listUnsubscribe: unsubscribeUrl,
        });
        rocketEmailsSent++;
      } catch (e) {
        if (e instanceof EmailQuotaError) quotaExhausted = true;
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
    ...(quotaExhausted ? { quotaExhausted: true } : {}),
  });
}

// --- zepto-webhook (bounce/complaint scrub) --------------------------------
export async function handleZeptoWebhook(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return json({ error: "alerts not configured" }, 503);
  const secret = env.ZEPTOMAIL_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook not configured" }, 503);

  const payload = await request.text();
  const ok = await verifyZeptoWebhook({
    secret,
    signatureHeader: request.headers.get("producer-signature"),
    payload,
  });
  if (!ok) return json({ error: "invalid signature" }, 401);

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  if (!isRemovableEvent(event)) return json({ ok: true, ignored: true });

  let removed = 0;
  for (const raw of recipientsFromEvent(event)) {
    const email = normalizeEmail(raw);
    if (!email) continue;
    try {
      const r = await removeAllForEmail(cfg, email);
      removed += r.motors + r.rockets;
    } catch {
      // best-effort; on our 200 ZeptoMail won't retry.
    }
  }
  return json({ ok: true, removed });
}

// --- admin/backfill --------------------------------------------------------
export async function handleBackfill(request: Request, env: EnvSource): Promise<Response> {
  const cfg = alertConfig(env);
  if (!cfg) return json({ error: "alerts not configured" }, 503);

  if (!hasDispatchBearer(request, cfg)) {
    return json({ error: "unauthorized" }, 401);
  }

  let keysScanned = 0;
  let backfilled = 0;
  try {
    const keys = await scanKeys(cfg, "sub:*");
    for (const key of keys) {
      keysScanned++;
      const mKey = key.slice("sub:".length);
      const emails = await smembers(cfg, key);
      for (const email of emails) {
        await sadd(cfg, userMotorsKey(email), mKey);
        backfilled++;
      }
    }
  } catch (e) {
    return json({ error: `backfill failed: ${(e as Error).message}` }, 500);
  }
  return json({ ok: true, keysScanned, backfilled });
}
