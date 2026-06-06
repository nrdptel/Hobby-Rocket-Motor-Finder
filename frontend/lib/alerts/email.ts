// Resend email sender (plain fetch against their REST API) + the two email
// templates the alert system sends: a double-opt-in confirmation and a restock
// notification. Kept text-light and inbox-friendly.

type SendArgs = {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  // RFC 8058 one-click unsubscribe header (helps deliverability + gives the
  // mail client a native unsubscribe button).
  listUnsubscribe?: string;
};

export async function sendEmail(args: SendArgs): Promise<void> {
  const headers: Record<string, string> = {};
  if (args.listUnsubscribe) {
    headers["List-Unsubscribe"] = `<${args.listUnsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      headers,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`resend send failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
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
): { subject: string; html: string; text: string } {
  const d = esc(designation);
  return {
    subject: `${designation} is back in stock`,
    text:
      `${designation} just came back in stock.\n\n` +
      `See vendors & prices: ${motorUrl}\n\n` +
      `Stock is best-effort and may sell out fast — confirm on the vendor's site.\n\n` +
      `Unsubscribe from ${designation} alerts: ${unsubscribeUrl}\n` +
      `Manage all your alerts: ${manageUrl}`,
    html:
      `<p><strong>${d}</strong> just came back in stock.</p>` +
      `<p><a href="${esc(motorUrl)}">See vendors &amp; prices →</a></p>` +
      `<p style="color:#666;font-size:12px">Stock is best-effort and may sell out fast — confirm on the vendor's site before buying.</p>` +
      `<p style="color:#666;font-size:12px"><a href="${esc(unsubscribeUrl)}">Unsubscribe from ${d} alerts</a> · ` +
      `<a href="${esc(manageUrl)}">manage all your alerts</a></p>`,
  };
}
