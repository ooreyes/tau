import type { SVGProps } from "react";

/**
 * Bode, Tau's circuit assistant. The resistor body stays intentionally simple
 * at toolbar size while the face gives the assistant a friendly identity.
 */
export function BodeMascot({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 44"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M2 22h10M52 22h10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <rect x="11" y="7" width="42" height="30" rx="13" fill="var(--bode-body, currentColor)" />
      <path
        d="M20 8.5v27M26 7.5v29M38 7.5v29M44 8.5v27"
        stroke="var(--bode-band, currentColor)"
        strokeWidth="3"
        opacity=".72"
      />
      <circle cx="28" cy="19" r="2" fill="var(--bode-face, currentColor)" />
      <circle cx="38" cy="19" r="2" fill="var(--bode-face, currentColor)" />
      <path
        d="M27 25.5c1.8 2 3.8 3 6 3s4.2-1 6-3"
        stroke="var(--bode-face, currentColor)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
