// Cloudflare Pages Function: POST /api/alerts/manage-request
// Requests a magic link by email. The lookup+send is deferred via
// context.waitUntil so response latency is identical whether or not the address
// has alerts (closes a timing oracle) — the Pages equivalent of next/server
// `after`. See subscribe.ts for the wrapper pattern.
import { handleManageRequest } from "../../../lib/alerts/handlers";

type Ctx = {
  request: Request;
  env: Record<string, string | undefined>;
  waitUntil: (p: Promise<unknown>) => void;
};

export const onRequestPost = (context: Ctx): Promise<Response> =>
  handleManageRequest(context.request, context.env, (p) => context.waitUntil(p));
