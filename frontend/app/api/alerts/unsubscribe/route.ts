import { alertConfig, subKey, userMotorsKey } from "@/lib/alerts/config";
import { designationFromKey, resultPage } from "@/lib/alerts/resultPage";
import { verifyToken } from "@/lib/alerts/tokens";
import { srem } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

async function unsubscribe(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return resultPage("Alerts unavailable", "Email alerts aren't configured.", "/", 503);

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = await verifyToken(cfg.secret, token);
  if (!payload || payload.t !== "u") {
    return resultPage("Invalid link", "This unsubscribe link isn't valid.", cfg.siteUrl, 400);
  }

  try {
    await srem(cfg, subKey(payload.m), payload.e); // motor → subscribers
    await srem(cfg, userMotorsKey(payload.e), payload.m); // email → motors (manage page)
  } catch {
    return resultPage(
      "Something went wrong",
      "We couldn't process the unsubscribe just now. Please try again later.",
      cfg.siteUrl,
      500,
    );
  }

  const designation = designationFromKey(payload.m);
  return resultPage(
    "Unsubscribed",
    `${payload.e} will no longer get ${designation} restock alerts.`,
    cfg.siteUrl,
  );
}

// Clicked from an email (GET) and used by the RFC 8058 one-click POST header.
export const GET = unsubscribe;
export const POST = unsubscribe;
