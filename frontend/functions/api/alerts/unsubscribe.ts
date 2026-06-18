// Cloudflare Pages Function: /api/alerts/unsubscribe?token=...
// GET = clicked from an email; POST = RFC 8058 one-click List-Unsubscribe header.
// Both call the same handler. See subscribe.ts for the wrapper pattern.
import { handleUnsubscribe } from "../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestGet = (context: Ctx): Promise<Response> =>
  handleUnsubscribe(context.request, context.env);

export const onRequestPost = (context: Ctx): Promise<Response> =>
  handleUnsubscribe(context.request, context.env);
