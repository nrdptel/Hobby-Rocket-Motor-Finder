import { alertConfig, subKey, userMotorsKey } from "@/lib/alerts/config";
import { designationFromKey, resultPage } from "@/lib/alerts/resultPage";
import { verifyToken } from "@/lib/alerts/tokens";
import { sadd } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return resultPage("Alerts unavailable", "Email alerts aren't configured.", "/", 503);

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = await verifyToken(cfg.secret, token);
  if (!payload || payload.t !== "c") {
    return resultPage(
      "Link expired",
      "This confirmation link is invalid or has expired. Try subscribing again.",
      cfg.siteUrl,
      400,
    );
  }

  try {
    await sadd(cfg, subKey(payload.m), payload.e); // motor → subscribers (dispatch)
    await sadd(cfg, userMotorsKey(payload.e), payload.m); // email → motors (manage page)
  } catch {
    return resultPage(
      "Something went wrong",
      "We couldn't confirm your subscription just now. Please try again later.",
      cfg.siteUrl,
      500,
    );
  }

  const designation = designationFromKey(payload.m);
  return resultPage(
    "You're subscribed ✓",
    `We'll email ${payload.e} when ${designation} comes back in stock. You can unsubscribe from any alert email.`,
    cfg.siteUrl,
  );
}
