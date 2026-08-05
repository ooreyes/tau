import type { SVGProps } from "react";

/**
 * Bode mark: a clean resistor silhouette (leads + body + bands). No face.
 * Reads as an EE instrument brand, not a cartoon.
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
      <rect x="11" y="10" width="42" height="24" rx="6" fill="var(--bode-body, currentColor)" />
      <path
        d="M20 11v22M26 10v24M38 10v24M44 11v22"
        stroke="var(--bode-band, currentColor)"
        strokeWidth="3"
        opacity=".72"
      />
    </svg>
  );
}
