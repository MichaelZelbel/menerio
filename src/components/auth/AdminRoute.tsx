import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && role !== "admin") {
      navigate("/dashboard", { replace: true });
    }
  }, [loading, role, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
        <ShieldAlert className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-display font-bold">Access Denied</h2>
        <p className="text-sm text-muted-foreground">You don't have permission to access the admin area.</p>
      </div>
    );
  }

  return <>{children}</>;
}
