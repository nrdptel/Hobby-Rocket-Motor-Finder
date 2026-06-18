// Cloudflare Pages Function: GET /api/alerts/confirm?token=...
// Confirmation links are clicked from email (GET). See subscribe.ts for the pattern.
import { handleConfirm } from "../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestGet = (context: Ctx): Promise<Response> =>
  handleConfirm(context.request, context.env);
