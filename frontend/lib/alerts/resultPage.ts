// A tiny self-contained HTML page returned by the confirm / unsubscribe GET
// links (which open directly from an email). No React needed; keeps these
// endpoints dependency-free and dark-mode friendly.

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function resultPage(
  title: string,
  message: string,
  siteUrl: string,
  status = 200,
): Response {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} — HPR Motor Finder</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font-family: ui-sans-serif, system-ui, sans-serif; background:#fff; color:#18181b; }
  @media (prefers-color-scheme: dark){ body{ background:#09090b; color:#fafafa; } }
  .card { max-width:32rem; padding:2rem 1.5rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; }
  p { color:#71717a; line-height:1.5; }
  a { color:inherit; }
</style></head>
<body><div class="card">
  <h1>${escape(title)}</h1>
  <p>${escape(message)}</p>
  <p><a href="${escape(siteUrl)}">← Back to HPR Motor Finder</a></p>
</div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** designation back out of a ``manufacturer::designation`` motorKey. */
export function designationFromKey(key: string): string {
  const i = key.indexOf("::");
  return i >= 0 ? key.slice(i + 2) : key;
}

/** {manufacturer, designation} out of a ``manufacturer::designation`` motorKey. */
export function splitKey(key: string): { manufacturer: string; designation: string } {
  const i = key.indexOf("::");
  return i >= 0
    ? { manufacturer: key.slice(0, i), designation: key.slice(i + 2) }
    : { manufacturer: "", designation: key };
}

/** The token-gated "manage my alerts" page: lists a user's subscriptions, each
 * with an unsubscribe link, plus an unsubscribe-all link. Rendered only after a
 * valid magic-link token is verified, so it never exposes anyone else's data. */
export function managePage(
  email: string,
  motorKeys: string[],
  token: string,
  siteUrl: string,
): Response {
  const t = encodeURIComponent(token);
  const rows = motorKeys
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((k) => {
      const { manufacturer, designation } = splitKey(k);
      const label = manufacturer ? `${designation} — ${manufacturer}` : designation;
      const link = `/api/alerts/manage?token=${t}&unsub=${encodeURIComponent(k)}`;
      return `<li><span>${escape(label)}</span><a class="unsub" href="${escape(link)}">Unsubscribe</a></li>`;
    })
    .join("");

  const body = motorKeys.length
    ? `<p class="sub">${escape(email)} is subscribed to <strong>${motorKeys.length}</strong> motor${
        motorKeys.length === 1 ? "" : "s"
      }.</p>
       <ul class="list">${rows}</ul>
       <p><a class="unsuball" href="/api/alerts/manage?token=${t}&unsuball=1">Unsubscribe from all</a></p>`
    : `<p class="sub">${escape(email)} has no active restock alerts.</p>`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Manage alerts — HPR Motor Finder</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    font-family: ui-sans-serif, system-ui, sans-serif; background:#fff; color:#18181b; }
  @media (prefers-color-scheme: dark){ body{ background:#09090b; color:#fafafa; } }
  .card { width:min(34rem, 92vw); padding:2rem 1.5rem; }
  h1 { font-size:1.25rem; margin:0 0 .75rem; }
  .sub { color:#71717a; line-height:1.5; }
  .list { list-style:none; margin:1rem 0; padding:0; border:1px solid #e4e4e7; border-radius:.5rem; }
  @media (prefers-color-scheme: dark){ .list{ border-color:#27272a; } }
  .list li { display:flex; align-items:center; justify-content:space-between; gap:1rem;
    padding:.75rem 1rem; border-top:1px solid #e4e4e7; }
  @media (prefers-color-scheme: dark){ .list li{ border-top-color:#27272a; } }
  .list li:first-child { border-top:0; }
  .unsub { color:#dc2626; text-decoration:none; font-size:.875rem; white-space:nowrap; }
  .unsub:hover { text-decoration:underline; }
  .unsuball { color:#dc2626; font-size:.875rem; }
  a { color:inherit; }
  .back { display:inline-block; margin-top:1rem; color:#71717a; }
</style></head>
<body><div class="card">
  <h1>Your restock alerts</h1>
  ${body}
  <a class="back" href="${escape(siteUrl)}">← Back to HPR Motor Finder</a>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
