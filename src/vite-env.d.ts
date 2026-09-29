/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** ISO time of the build (vite.config.ts `define`); absent under vitest. */
declare const __BUILD_TIME__: string | undefined;

declare module "canvas-confetti" {
  interface Options {
    particleCount?: number;
    spread?: number;
    origin?: { x?: number; y?: number };
    angle?: number;
    startVelocity?: number;
    decay?: number;
    gravity?: number;
    drift?: number;
    ticks?: number;
    colors?: string[];
    shapes?: string[];
    scalar?: number;
    zIndex?: number;
    disableForReducedMotion?: boolean;
  }
  function confetti(options?: Options): Promise<null>;
  export = confetti;
}
