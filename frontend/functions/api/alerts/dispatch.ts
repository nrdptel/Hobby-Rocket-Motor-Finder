// Cloudflare Pages Function: POST /api/alerts/dispatch
// Called by the hourly CI scrape (bearer-authed) with the motors that restocked;
// looks up subscribers and emails them. See subscribe.ts for the wrapper pattern.
import { handleDispatch } from "../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestPost = (context: Ctx): Promise<Response> =>
  handleDispatch(context.request, context.env);
