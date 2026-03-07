import { useAuth, type AppRole } from "@/contexts/AuthContext";

export function useSubscription() {
  const { role, loading } = useAuth();

  const isPremium =
    role === "premium" || role === "premium_gift" || role === "admin";

  return {
    role: role as AppRole | null,
    isPremium,
    isLoading: loading,
  };
}
