// Cloudflare Pages Function: POST /api/alerts/admin/backfill
// One-time maintenance (bearer-authed, same trust as dispatch): backfills the
// per-email reverse index for pre-#50 subscriptions. See subscribe.ts for the
// wrapper pattern.
import { handleBackfill } from "../../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestPost = (context: Ctx): Promise<Response> =>
  handleBackfill(context.request, context.env);
