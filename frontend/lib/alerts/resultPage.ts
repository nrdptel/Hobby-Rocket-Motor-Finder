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
