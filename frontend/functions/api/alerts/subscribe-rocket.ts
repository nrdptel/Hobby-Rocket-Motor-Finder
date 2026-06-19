// Cloudflare Pages Function: POST /api/alerts/subscribe-rocket
// Thin wrapper around the portable handler; see subscribe.ts for the pattern.
import { handleSubscribeRocket } from "../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestPost = (context: Ctx): Promise<Response> =>
  handleSubscribeRocket(context.request, context.env);
