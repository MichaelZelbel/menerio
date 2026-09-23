import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { clearReturnTo, peekReturnTo } from "@/lib/return-to";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  // Path AND query string: /connect-godspeed?request=... is useless without its
  // query, and that is exactly the page an anonymous visitor arrives on.
  const here = `${location.pathname}${location.search}`;

  // A Google or GitHub sign-in always comes back to /dashboard. If the visitor
  // was heading somewhere else first, that place was remembered; take them there
  // once, and forget it so the dashboard is reachable again afterwards.
  const pending = session ? peekReturnTo() : null;
  useEffect(() => {
    if (session && pending) clearReturnTo();
  }, [session, pending]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent(here)}`} replace />;
  }

  if (pending && pending !== here) {
    return <Navigate to={pending} replace />;
  }

  return <>{children}</>;
}
