import { Suspense, lazy, useMemo } from "react";
import { Circle, type LucideProps } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";

interface ProfileIconProps extends Omit<LucideProps, "ref"> {
  name: string;
}

const fallback = <div className="h-4 w-4" />;

/**
 * Module-level cache of resolved lazy components, so each unique icon name
 * is wrapped in `lazy()` exactly once across the whole app lifetime.
 *
 * Without this, every render created a brand-new `lazy()` component, which
 * forced React to re-suspend and re-import the icon chunk every time —
 * the main cause of icon flickering and excess network requests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iconCache = new Map<string, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLazyIcon(name: string): any {
  const cached = iconCache.get(name);
  if (cached) return cached;
  const importer = (dynamicIconImports as Record<string, () => Promise<unknown>>)[name];
  if (!importer) return null;
  // By-name icon chunks are not in the service-worker precache (see
  // lazyOnlyIcons in vite.config.ts), so offline the import can fail. A
  // rejected lazy() would throw to the error boundary and take the whole
  // profile down; draw the fallback circle instead.
  const Component = lazy(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (importer() as Promise<any>).catch(() => ({ default: Circle })),
  );
  iconCache.set(name, Component);
  return Component;
}

export function ProfileIcon({ name, ...props }: ProfileIconProps) {
  const LucideIcon = useMemo(() => getLazyIcon(name), [name]);
  if (!LucideIcon) return <Circle {...props} />;
  return (
    <Suspense fallback={fallback}>
      <LucideIcon {...props} />
    </Suspense>
  );
}
