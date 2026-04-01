import { lazy, Suspense } from "react";
import { LucideProps } from "lucide-react";
import dynamicIconImports from "lucide-react/dynamicIconImports";

interface ProfileIconProps extends Omit<LucideProps, "ref"> {
  name: string;
}

const fallback = <div className="h-4 w-4" />;

export function ProfileIcon({ name, ...props }: ProfileIconProps) {
  const iconName = name as keyof typeof dynamicIconImports;
  if (!dynamicIconImports[iconName]) {
    const Fallback = lazy(dynamicIconImports["circle"]);
    return (
      <Suspense fallback={fallback}>
        <Fallback {...props} />
      </Suspense>
    );
  }
  const LucideIcon = lazy(dynamicIconImports[iconName]);
  return (
    <Suspense fallback={fallback}>
      <LucideIcon {...props} />
    </Suspense>
  );
}
