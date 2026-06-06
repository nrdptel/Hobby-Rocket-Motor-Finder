// Builds a direct, token-gated manage-page URL for embedding in outgoing emails.
// Because the email is already addressed to the subscriber, we can mint the
// magic-link token at send time so "manage all your alerts" opens their list
// straight away — no need to bounce through the /alerts re-enter-your-email form.
// Same privacy property as the magic link: only the inbox owner gets it.

import type { AlertConfig } from "./config";
import { signToken } from "./tokens";

// Longer-lived than a freshly-requested magic link (1h) since an email may be
// opened a day or two later, but short enough that a stale forwarded email can't
// manage someone's alerts for long. If it has expired, the recipient just
// re-requests a fresh link from /alerts.
const EMAIL_MANAGE_TTL_S = 72 * 3600; // 72 hours

/** A `/api/alerts/manage?token=…` URL that opens this email's subscription list. */
export async function manageLink(cfg: AlertConfig, email: string): Promise<string> {
  const token = await signToken(cfg.secret, {
    t: "m",
    e: email,
    m: "",
    x: Math.floor(Date.now() / 1000) + EMAIL_MANAGE_TTL_S,
  });
  return `${cfg.siteUrl}/api/alerts/manage?token=${encodeURIComponent(token)}`;
}
