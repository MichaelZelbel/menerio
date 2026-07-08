import { useLayoutEffect, useRef, useState } from "react";

/**
 * Tracks an element's rendered width via ResizeObserver.
 *
 * Returns `null` until the first measurement; the initial measure runs in
 * useLayoutEffect (before paint), so consumers that render a "measuring"
 * layout for `null` never flash it on screen.
 */
export function useElementWidth<T extends HTMLElement>(): [
  React.RefObject<T>,
  number | null,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.offsetWidth);
    const observer = new ResizeObserver(() => {
      setWidth(el.offsetWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
