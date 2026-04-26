import { cn } from "@/lib/utils";

type MeniProps = {
  size?: number;
  className?: string;
};

function Sparkle({ className }: { className?: string }) {
  return (
    <g className={cn("meni-sparkle", className)}>
      <path
        d="M0 -7 L1.5 -1.5 L7 0 L1.5 1.5 L0 7 L-1.5 1.5 L-7 0 L-1.5 -1.5 Z"
        fill="hsl(var(--mascot-sky-highlight))"
      />
    </g>
  );
}

export function Meni({ size = 220, className }: MeniProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      className={cn("meni-mascot", className)}
      role="img"
      aria-label="Meni, the Menerio mascot"
    >
      <defs>
        <radialGradient id="meni-body" cx=".4" cy=".3" r=".75">
          <stop offset="0%" stopColor="hsl(var(--mascot-sky-white))" />
          <stop offset="50%" stopColor="hsl(var(--mascot-sky-soft))" />
          <stop offset="100%" stopColor="hsl(var(--mascot-sky-primary))" />
        </radialGradient>
        <radialGradient id="meni-shine" cx=".35" cy=".25" r=".5">
          <stop offset="0%" stopColor="hsl(var(--mascot-plain-white))" stopOpacity=".9" />
          <stop offset="100%" stopColor="hsl(var(--mascot-plain-white))" stopOpacity="0" />
        </radialGradient>
        <filter id="meni-soft-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="16" stdDeviation="18" floodColor="hsl(var(--mascot-sky-primary))" floodOpacity=".28" />
        </filter>
      </defs>

      <g className="meni-sparkles">
        <g transform="translate(40 70)"><Sparkle /></g>
        <g transform="translate(195 90)"><Sparkle className="[animation-delay:.4s]" /></g>
        <g transform="translate(50 170)"><Sparkle className="[animation-delay:.8s]" /></g>
        <g transform="translate(190 160)"><Sparkle className="[animation-delay:1.2s]" /></g>
      </g>

      <ellipse cx="120" cy="218" rx="48" ry="6" fill="hsl(var(--mascot-shadow))" opacity=".4">
        <animate attributeName="rx" values="48;38;48" dur="3.5s" repeatCount="indefinite" />
      </ellipse>

      <g className="meni-body" filter="url(#meni-soft-shadow)">
        <path
          d="M75 110 C75 70 165 70 165 110 L165 180 Q152 190 145 180 Q138 195 125 180 Q118 195 105 180 Q95 195 85 180 L75 180 Z"
          fill="url(#meni-body)"
          stroke="hsl(var(--mascot-sky-light))"
          strokeWidth="1.5"
        />
        <ellipse cx="98" cy="92" rx="22" ry="14" fill="url(#meni-shine)" />
      </g>

      <g className="meni-eyes">
        <ellipse cx="103" cy="125" rx="6" ry="9" fill="hsl(var(--mascot-ink))" />
        <ellipse cx="137" cy="125" rx="6" ry="9" fill="hsl(var(--mascot-ink))" />
        <circle cx="105" cy="121" r="2.2" fill="hsl(var(--mascot-plain-white))" />
        <circle cx="139" cy="121" r="2.2" fill="hsl(var(--mascot-plain-white))" />
      </g>
      <path d="M114 145 Q120 150 126 145" stroke="hsl(var(--mascot-ink))" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="93" cy="142" rx="5" ry="3" fill="hsl(var(--mascot-plain-white))" opacity=".7" />
      <ellipse cx="147" cy="142" rx="5" ry="3" fill="hsl(var(--mascot-plain-white))" opacity=".7" />
    </svg>
  );
}