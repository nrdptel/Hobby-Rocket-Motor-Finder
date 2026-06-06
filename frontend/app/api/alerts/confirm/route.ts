import { alertConfig, rocketSubsKey, subKey, userMotorsKey, userRocketsKey } from "@/lib/alerts/config";
import { designationFromKey, resultPage } from "@/lib/alerts/resultPage";
import {
  parseRocketSpecField,
  rocketDisplayName,
  rocketMember,
} from "@/lib/alerts/rocketSub";
import { verifyToken } from "@/lib/alerts/tokens";
import { sadd } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return resultPage("Alerts unavailable", "Email alerts aren't configured.", "/", 503);

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = await verifyToken(cfg.secret, token);
  if (!payload || (payload.t !== "c" && payload.t !== "rc")) {
    return resultPage(
      "Link expired",
      "This confirmation link is invalid or has expired. Try subscribing again.",
      cfg.siteUrl,
      400,
    );
  }

  // Rocket-fit subscription: "anything that fits <rocket> restocks".
  if (payload.t === "rc") {
    const fields = parseRocketSpecField(payload.m);
    if (!fields) {
      return resultPage("Link expired", "This confirmation link isn't valid.", cfg.siteUrl, 400);
    }
    const member = rocketMember(payload.e, fields);
    try {
      await sadd(cfg, rocketSubsKey(), member); // all rocket subs (dispatch iterates)
      await sadd(cfg, userRocketsKey(payload.e), member); // email → rocket subs (manage)
    } catch {
      return resultPage(
        "Something went wrong",
        "We couldn't confirm your subscription just now. Please try again later.",
        cfg.siteUrl,
        500,
      );
    }
    return resultPage(
      "You're subscribed ✓",
      `We'll email ${payload.e} when any motor that fits ${rocketDisplayName(fields)} comes back in stock. You can unsubscribe from any alert email.`,
      cfg.siteUrl,
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
