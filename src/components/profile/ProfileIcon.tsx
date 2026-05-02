import { Suspense, lazy, useMemo, type ComponentType } from "react";
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
const iconCache = new Map<string, ComponentType<LucideProps>>();

function getLazyIcon(name: string): ComponentType<LucideProps> {
  const cached = iconCache.get(name);
  if (cached) return cached;
  const importer =
    (dynamicIconImports as Record<string, () => Promise<{ default: ComponentType<LucideProps> }>>)[name];
  if (!importer) return Circle;
  const Component = lazy(importer);
  iconCache.set(name, Component);
  return Component;
}

export function ProfileIcon({ name, ...props }: ProfileIconProps) {
  const LucideIcon = useMemo(() => getLazyIcon(name), [name]);
  if (LucideIcon === Circle) return <Circle {...props} />;
  return (
    <Suspense fallback={fallback}>
      <LucideIcon {...props} />
    </Suspense>
  );
}
