// Shared subscription-store mutations used by more than one route.

import {
  rocketSubsKey,
  subKey,
  userMotorsKey,
  userRocketsKey,
  type AlertConfig,
} from "./config";
import { smembers, srem } from "./upstash";

/** Remove an email from ALL its subscriptions — every per-motor set and every
 * rocket-fit subscription — using the reverse indexes. Powers both
 * unsubscribe-all on the manage page and the bounce/complaint webhook (which
 * must scrub a dead/complaining address so it's never emailed again). */
export async function removeAllForEmail(
  cfg: AlertConfig,
  email: string,
): Promise<{ motors: number; rockets: number }> {
  const motorKeys = await smembers(cfg, userMotorsKey(email));
  for (const k of motorKeys) {
    await srem(cfg, subKey(k), email);
    await srem(cfg, userMotorsKey(email), k);
  }
  const rocketMembers = await smembers(cfg, userRocketsKey(email));
  for (const mem of rocketMembers) {
    await srem(cfg, rocketSubsKey(), mem);
    await srem(cfg, userRocketsKey(email), mem);
  }
  return { motors: motorKeys.length, rockets: rocketMembers.length };
}
