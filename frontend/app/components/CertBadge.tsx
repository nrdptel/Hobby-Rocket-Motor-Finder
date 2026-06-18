import { certRequirement, type CertMotorInput } from "@/lib/derive";

/** Small badge marking the NAR/Tripoli cert level a motor requires (L1/L2/L3).
 * Renders nothing for motors that need no HPR certification. The requirement is
 * the full one — not just the impulse-class letter — so a sub-H motor that's
 * high-power by average thrust (> 80 N), propellant (> 62.5 g), or sparky/hybrid
 * propellant correctly shows "L1", and the tooltip says why. */
export function CertBadge({ motor }: { motor: CertMotorInput }) {
  const cert = certRequirement(motor);
  if (!cert) return null;
  const title = cert.reason
    ? `High-power motor (${cert.reason}) — requires NAR/Tripoli ${cert.label} certification`
    : `Requires NAR/Tripoli ${cert.label} certification (${cert.sublabel} motors)`;
  return (
    <span
      className="inline-flex items-center rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-800/60 dark:bg-sky-950 dark:text-sky-300"
      title={title}
    >
      {cert.label}
    </span>
  );
}
