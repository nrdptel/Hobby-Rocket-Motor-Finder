// ZeptoMail transactional email sender (via the v1.1 REST API) + the email
// templates the alert system sends: a double-opt-in confirmation and a restock
// notification. Kept text-light and inbox-friendly. No SDK — a single fetch to
// the documented JSON endpoint, so the function stays dependency-free and runs
// on the Edge/Node runtime unchanged.

type SendArgs = {
  zepto: { host: string; token: string };
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  // RFC 8058 one-click unsubscribe header (helps deliverability + gives the
  // mail client a native unsubscribe button). Passed through ZeptoMail's
  // `mime_headers`, which injects arbitrary MIME headers into the message.
  listUnsubscribe?: string;
};

/** Thrown when ZeptoMail rejects a send because the account's sending credits /
 * quota are exhausted. Distinct from a transient/recipient failure so callers
 * can raise an ops signal and stop hammering the API instead of treating it as
 * a per-recipient blip. */
export class EmailQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailQuotaError";
  }
}

/** Split an RFC 5322 `Name <addr>` (or a bare address) into ZeptoMail's
 * `{ address, name }` shape. */
export function parseFrom(from: string): { address: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].replace(/^"|"$/g, "").trim();
    return name ? { address: m[2].trim(), name } : { address: m[2].trim() };
  }
  return { address: from.trim() };
}

/** Authorization header value. The Agent's "Send Mail token" already includes
 * the `Zoho-enczapikey ` prefix; tolerate a bare key too. */
function authHeader(token: string): string {
  return /^Zoho-enczapikey\s/i.test(token) ? token : `Zoho-enczapikey ${token}`;
}

/** Detect ZeptoMail's "out of credits / over quota" rejection so the caller can
 * raise an ops signal rather than silently dropping the batch. Matches on both
 * the documented error codes and a message fallback (so a renamed code still
 * trips the signal). */
export function isQuotaError(status: number, code: string, message: string): boolean {
  if (status === 402) return true;
  const c = code.toUpperCase();
  if (c === "TM_3201" || c === "SM_133") return true;
  return /\b(credit|quota)s?\b|limit\s*exceed|insufficient/i.test(message);
}

/** Collapse control characters (incl. CR/LF) to spaces. Subjects embed
 * scraped, third-party data (motor designations, rocket names); ZeptoMail's
 * JSON REST API already neutralizes header injection, but stripping control
 * chars at the single send chokepoint is cheap defense-in-depth and keeps a
 * stray newline from mangling how a client renders the subject line. */
const oneLineSubject = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

export async function sendEmail(args: SendArgs): Promise<void> {
  const body: Record<string, unknown> = {
    from: parseFrom(args.from),
    to: [{ email_address: { address: args.to } }],
    subject: oneLineSubject(args.subject),
    htmlbody: args.html,
    textbody: args.text,
  };
  if (args.listUnsubscribe) {
    body.mime_headers = {
      "List-Unsubscribe": `<${args.listUnsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  // A throw means "not sent": the caller rolls back its cooldown so the next run
  // retries. fetch only rejects on network errors, so we must inspect the status
  // ourselves and throw on any non-2xx. A 10s deadline keeps a hung ZeptoMail
  // connection from tying up the dispatch route (which has a 60s budget for the
  // whole batch) — the abort surfaces as a thrown Error, same as a network blip.
  let res: Response;
  try {
    res = await fetch(`https://${args.zepto.host}/v1.1/email`, {
      method: "POST",
      headers: {
        Authorization: authHeader(args.zepto.token),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new Error(`ZeptoMail request failed: ${(e as Error).message}`);
  }

  if (res.ok) return;

  // Non-2xx: pull the code/message out of ZeptoMail's `{ error: { code, message } }`
  // envelope for a useful log line + quota detection.
  let code = "";
  let message = "";
  try {
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    code = j.error?.code ?? "";
    message = j.error?.message ?? "";
  } catch {
    /* body wasn't JSON */
  }
  if (isQuotaError(res.status, code, message)) {
    // Distinct, greppable ops line — point a log drain / alert at it.
    console.error(
      `[alerts] ZeptoMail quota exhausted (status=${res.status} code=${code}): ${message}`,
    );
    throw new EmailQuotaError(`ZeptoMail quota exhausted: ${code || res.status}`);
  }
  throw new Error(`ZeptoMail send failed (status=${res.status} code=${code}): ${message}`);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function confirmEmail(
  designation: string,
  confirmUrl: string,
  manageUrl: string,
): {
  subject: string;
  html: string;
  text: string;
} {
  const d = esc(designation);
  return {
    subject: `Confirm restock alerts for ${designation}`,
    text:
      `Confirm you want restock alerts for ${designation}.\n\n` +
      `Confirm: ${confirmUrl}\n\n` +
      `If you didn't request this, ignore this email — no alerts will be sent.\n\n` +
      `Manage all your alerts anytime: ${manageUrl}`,
    html:
      `<p>Confirm you want <strong>restock alerts</strong> for <strong>${d}</strong>.</p>` +
      `<p><a href="${esc(confirmUrl)}">Confirm subscription</a></p>` +
      `<p style="color:#666;font-size:12px">If you didn't request this, ignore this email — no alerts will be sent.</p>` +
      `<p style="color:#666;font-size:12px"><a href="${esc(manageUrl)}">Manage all your alerts</a></p>`,
  };
}

export function rocketConfirmEmail(
  name: string,
  spec: string,
  confirmUrl: string,
  manageUrl: string,
): { subject: string; html: string; text: string } {
  const n = esc(name);
  const s = esc(spec);
  return {
    subject: `Confirm restock alerts for ${name}`,
    text:
      `Confirm restock alerts for any motor that fits ${name} (${spec}).\n\n` +
      `We'll email you when an out-of-stock motor matching it comes back.\n\n` +
      `Confirm: ${confirmUrl}\n\n` +
      `If you didn't request this, ignore this email — no alerts will be sent.\n\n` +
      `Manage all your alerts anytime: ${manageUrl}`,
    html:
      `<p>Confirm <strong>restock alerts</strong> for any motor that fits ` +
      `<strong>${n}</strong> <span style="color:#666">(${s})</span>.</p>` +
      `<p>We'll email you when an out-of-stock motor matching it comes back.</p>` +
      `<p><a href="${esc(confirmUrl)}">Confirm subscription</a></p>` +
      `<p style="color:#666;font-size:12px">If you didn't request this, ignore this email — no alerts will be sent.</p>` +
      `<p style="color:#666;font-size:12px"><a href="${esc(manageUrl)}">Manage all your alerts</a></p>`,
  };
}

export function rocketRestockEmail(
  name: string,
  motors: ReadonlyArray<{ designation: string; manufacturer: string; url: string }>,
  unsubscribeUrl: string,
  manageUrl: string,
): { subject: string; html: string; text: string } {
  const n = esc(name);
  const count = motors.length;
  const noun = count === 1 ? "motor" : "motors";
  const subject =
    count === 1
      ? `${motors[0].designation} fits ${name} and is back in stock`
      : `${count} motors that fit ${name} are back in stock`;
  const textList = motors.map((m) => `• ${m.manufacturer} ${m.designation}: ${m.url}`).join("\n");
  const htmlList = motors
    .map(
      (m) =>
        `<li><strong>${esc(m.manufacturer)} ${esc(m.designation)}</strong> — ` +
        `<a href="${esc(m.url)}">see vendors &amp; prices →</a></li>`,
    )
    .join("");
  return {
    subject,
    text:
      `${count} ${noun} that fit ${name} just came back in stock:\n\n` +
      `${textList}\n\n` +
      `Stock is best-effort and may sell out fast — confirm on the vendor's site.\n\n` +
      `Unsubscribe from ${name} alerts: ${unsubscribeUrl}\n` +
      `Manage all your alerts: ${manageUrl}`,
    html:
      `<p><strong>${count} ${noun}</strong> that fit <strong>${n}</strong> just came back in stock:</p>` +
      `<ul>${htmlList}</ul>` +
      `<p style="color:#666;font-size:12px">Stock is best-effort and may sell out fast — confirm on the vendor's site before buying.</p>` +
      `<p style="color:#666;font-size:12px"><a href="${esc(unsubscribeUrl)}">Unsubscribe from ${n} alerts</a> · ` +
      `<a href="${esc(manageUrl)}">manage all your alerts</a></p>`,
  };
}

export function manageEmail(manageUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  return {
    subject: `Manage your restock alerts`,
    text:
      `Here's your link to view and manage your motor restock alerts:\n\n` +
      `${manageUrl}\n\n` +
      `This link works for about an hour. If you didn't request it, ignore this email — ` +
      `nothing changes and the link reveals nothing to anyone else.`,
    html:
      `<p>Here's your link to view and manage your motor restock alerts:</p>` +
      `<p><a href="${esc(manageUrl)}">View &amp; manage my alerts →</a></p>` +
      `<p style="color:#666;font-size:12px">This link works for about an hour. If you didn't ` +
      `request it, ignore this email — nothing changes.</p>`,
  };
}

export function restockEmail(
  designation: string,
  motorUrl: string,
  unsubscribeUrl: string,
  manageUrl: string,
  // True for a "phantom" first appearance (a motor no tracked vendor stocked,
  // now listed) — reads "now in stock" rather than "back in stock".
  firstAvailable = false,
): { subject: string; html: string; text: string } {
  const d = esc(designation);
  const subject = firstAvailable
    ? `${designation} is now in stock`
    : `${designation} is back in stock`;
  const leadText = firstAvailable
    ? `${designation} just showed up in stock — no tracked vendor was carrying it before.`
    : `${designation} just came back in stock.`;
  const leadHtml = firstAvailable
    ? `<p><strong>${d}</strong> just showed up in stock — no tracked vendor was carrying it before.</p>`
    : `<p><strong>${d}</strong> just came back in stock.</p>`;
  return {
    subject,
    text:
      `${leadText}\n\n` +
      `See vendors & prices: ${motorUrl}\n\n` +
      `Stock is best-effort and may sell out fast — confirm on the vendor's site.\n\n` +
      `Unsubscribe from ${designation} alerts: ${unsubscribeUrl}\n` +
      `Manage all your alerts: ${manageUrl}`,
    html:
      leadHtml +
      `<p><a href="${esc(motorUrl)}">See vendors &amp; prices →</a></p>` +
      `<p style="color:#666;font-size:12px">Stock is best-effort and may sell out fast — confirm on the vendor's site before buying.</p>` +
      `<p style="color:#666;font-size:12px"><a href="${esc(unsubscribeUrl)}">Unsubscribe from ${d} alerts</a> · ` +
      `<a href="${esc(manageUrl)}">manage all your alerts</a></p>`,
  };
}
