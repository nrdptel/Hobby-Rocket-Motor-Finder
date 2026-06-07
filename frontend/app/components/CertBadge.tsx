import { certForClass } from "@/lib/derive";

/** Small badge marking the NAR/Tripoli cert level a motor requires (L1/L2/L3),
 * derived from its impulse class. Renders nothing for mid-power (D–G) motors,
 * which need no HPR certification. Teaches the class→cert mapping at a glance. */
export function CertBadge({ impulseClass }: { impulseClass: string }) {
  const cert = certForClass(impulseClass);
  if (!cert) return null;
  return (
    <span
      className="inline-flex items-center rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-800/60 dark:bg-sky-950 dark:text-sky-300"
      title={`Requires NAR/Tripoli ${cert.label} certification (${cert.sublabel} motors)`}
    >
      {cert.label}
    </span>
  );
}
