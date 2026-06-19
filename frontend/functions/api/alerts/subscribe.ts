// Cloudflare Pages Function: POST /api/alerts/subscribe
//
// Thin wrapper around the portable handler in lib/alerts/handlers.ts. Pages
// Functions receive a context { request, env, ... }; env (NOT process.env) is
// where Cloudflare exposes the secrets, so we pass context.env through to
// alertConfig via the handler. The handler returns a standard Response.
//
// NOTE: these Functions can only be validated on a live Cloudflare Pages deploy
// (they need the env bindings + a real fetch egress to Upstash/ZeptoMail). They
// are correct-by-construction: the handler bodies are the same code the old Next
// route handlers ran, exercised by lib/alerts/lifecycle.test.ts on Node.
import { handleSubscribe } from "../../../lib/alerts/handlers";

type Ctx = { request: Request; env: Record<string, string | undefined> };

export const onRequestPost = (context: Ctx): Promise<Response> =>
  handleSubscribe(context.request, context.env);
