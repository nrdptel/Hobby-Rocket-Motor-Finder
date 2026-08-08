import Link from "next/link";
import { formatImpulse, formatThrust, manufacturerLabel, motorPath } from "@/lib/derive";
import type { Motor } from "@/lib/snapshot";

/** The designation + specs half of a "similar motors in stock" row, linked to
 * that motor's detail page. Shared by the catalog's swap disclosure and the
 * detail page's own similar-motors list: both render the same suggestion from
 * different payloads (the compact `Substitute` vs a full `Motor`), so the
 * structural `Pick` is what they have in common.
 *
 * The designation carries a *resting* underline like every other motor link on
 * the site (MotorResults/MotorCard). Hover-only styling doesn't work here: there
 * is no hover on a touch screen, and the designation's color barely separates
 * from the specs beside it, so without the underline the row reads as plain
 * text and the link goes unnoticed — which was the whole complaint. */
export function SubstituteLink({
  motor,
}: {
  motor: Pick<Motor, "manufacturer" | "designation" | "total_impulse_ns" | "avg_thrust_n">;
}) {
  return (
    <Link
      href={motorPath(motor)}
      className="group min-w-0"
      title={`${motor.designation} details, specs & all vendors`}
    >
      <span className="font-mono text-zinc-900 underline decoration-zinc-300 underline-offset-2 group-hover:decoration-zinc-500 dark:text-zinc-100 dark:decoration-zinc-700 dark:group-hover:decoration-zinc-300">
        {motor.designation}
      </span>
      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
        {manufacturerLabel(motor.manufacturer)} · {formatImpulse(motor.total_impulse_ns)} ·{" "}
        {formatThrust(motor.avg_thrust_n)}
      </span>
    </Link>
  );
}
