// Cloudflare Pages Function: GET /api/alerts/manage?token=...[&unsub=...]
// Magic-link manage page (view + act). See subscribe.ts for the wrapper pattern.
import { handleManage } from "../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestGet = (context: Ctx): Promise<Response> =>
  handleManage(context.request, context.env);
