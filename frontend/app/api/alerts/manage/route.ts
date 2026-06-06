import {
  alertConfig,
  rocketSubsKey,
  subKey,
  userMotorsKey,
  userRocketsKey,
} from "@/lib/alerts/config";
import { managePage, resultPage } from "@/lib/alerts/resultPage";
import { describeRocketFields, parseRocketMember, rocketDisplayName } from "@/lib/alerts/rocketSub";
import { verifyToken } from "@/lib/alerts/tokens";
import { smembers, srem } from "@/lib/alerts/upstash";

export const dynamic = "force-dynamic";

// One endpoint handles both viewing and acting: the magic link in the email is
// the plain `?token=` form (lists only — safe for any prefetch), while the
// unsubscribe links live only on the rendered page and the user clicks them.
export async function GET(request: Request): Promise<Response> {
  const cfg = alertConfig();
  if (!cfg) return resultPage("Alerts unavailable", "Email alerts aren't configured.", "/", 503);

  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const payload = await verifyToken(cfg.secret, token);
  if (!payload || payload.t !== "m") {
    return resultPage(
      "Link expired",
      "This manage link is invalid or has expired. Request a fresh one from the site.",
      cfg.siteUrl,
      400,
    );
  }

  const email = payload.e;
  const unsub = url.searchParams.get("unsub");
  const unsubrocket = url.searchParams.get("unsubrocket");
  const unsuball = url.searchParams.get("unsuball");

  try {
    if (unsuball) {
      const keys = await smembers(cfg, userMotorsKey(email));
      for (const k of keys) {
        await srem(cfg, subKey(k), email);
        await srem(cfg, userMotorsKey(email), k);
      }
      const members = await smembers(cfg, userRocketsKey(email));
      for (const mem of members) {
        await srem(cfg, rocketSubsKey(), mem);
        await srem(cfg, userRocketsKey(email), mem);
      }
    } else if (unsub) {
      await srem(cfg, subKey(unsub), email);
      await srem(cfg, userMotorsKey(email), unsub);
    } else if (unsubrocket) {
      await srem(cfg, rocketSubsKey(), unsubrocket);
      await srem(cfg, userRocketsKey(email), unsubrocket);
    }

    const remaining = await smembers(cfg, userMotorsKey(email));
    const rocketMembers = await smembers(cfg, userRocketsKey(email));
    const rockets = rocketMembers
      .map((mem) => {
        const parsed = parseRocketMember(mem);
        if (!parsed) return null;
        return {
          member: mem,
          name: rocketDisplayName(parsed.fields),
          desc: describeRocketFields(parsed.fields),
        };
      })
      .filter((r): r is { member: string; name: string; desc: string } => r !== null);
    return managePage(email, remaining, rockets, token, cfg.siteUrl);
  } catch {
    return resultPage(
      "Something went wrong",
      "We couldn't load your alerts just now. Please try the link again in a moment.",
      cfg.siteUrl,
      500,
    );
  }
}
