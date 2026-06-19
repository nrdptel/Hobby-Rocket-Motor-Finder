// Cloudflare Pages Function: POST /api/alerts/zepto-webhook
// ZeptoMail bounce/complaint webhook — scrubs dead addresses from Upstash.
// Gated on env.ZEPTOMAIL_WEBHOOK_SECRET (passed through via the handler's env).
// See subscribe.ts for the wrapper pattern.
import { handleZeptoWebhook } from "../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestPost = (context: Ctx): Promise<Response> =>
  handleZeptoWebhook(context.request, context.env);
