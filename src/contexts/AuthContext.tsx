import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Session, User, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { clearPersistedQueries } from "@/lib/query-persister";
import { BRAND } from "@/lib/brand";

const LAST_USER_KEY = "menerio:last-user-id";

export type AppRole = "free" | "premium" | "premium_gift" | "admin";

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  /**
   * True while the user's role is being fetched from the database.
   * Authorization decisions (e.g. AdminRoute) MUST wait for this to be false
   * before treating a missing role as a denial — otherwise a real admin can
   * be redirected during the brief window between session hydration and role
   * hydration.
   */
  roleLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ success: boolean; alreadyExists?: boolean }>;
  signOut: () => Promise<void>;
  signInWithOAuth: (provider: "google" | "github") => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);
  const { toast } = useToast();

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", userId)
      .single();
    if (!error && data) setProfile(data as Profile);
  }, []);

  const fetchRole = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single();
      if (!error && data) {
        setRole(data.role as AppRole);
      }
    } finally {
      setRoleLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      setRoleLoading(true);
      await fetchProfile(user.id);
      await fetchRole(user.id);
    }
  }, [user, fetchProfile, fetchRole]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          // Offline cache is keyed per-origin, not per-user: wipe it when a
          // different account signs in so no data leaks across users.
          const lastUserId = localStorage.getItem(LAST_USER_KEY);
          if (lastUserId && lastUserId !== newSession.user.id) {
            void clearPersistedQueries();
          }
          localStorage.setItem(LAST_USER_KEY, newSession.user.id);
          // Ask the browser to exempt our storage (IndexedDB cache, future
          // local DB) from automatic eviction — matters most on iOS Safari.
          void navigator.storage?.persist?.();

          setRoleLoading(true);
          setTimeout(() => {
            fetchProfile(newSession.user.id);
            fetchRole(newSession.user.id);
          }, 0);
        } else {
          setProfile(null);
          setRole(null);
          setRoleLoading(false);
        }

        if (event === "SIGNED_OUT") {
          setProfile(null);
          setRole(null);
          setRoleLoading(false);
          void clearPersistedQueries();
        }

        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      setSession(existingSession);
      setUser(existingSession?.user ?? null);
      if (existingSession?.user) {
        setRoleLoading(true);
        fetchProfile(existingSession.user.id);
        fetchRole(existingSession.user.id);
      } else {
        setRoleLoading(false);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile, fetchRole]);

  const handleAuthError = (error: AuthError) => {
    const messages: Record<string, string> = {
      "Invalid login credentials": "Invalid email or password. Please try again.",
      "User already registered": "An account with this email already exists.",
      "Email not confirmed": "Please check your email and confirm your account.",
    };
    toast({
      variant: "destructive",
      title: "Authentication Error",
      description: messages[error.message] || error.message,
    });
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { handleAuthError(error); throw error; }
  };

  const signUp = async (email: string, password: string, displayName: string): Promise<{ success: boolean; alreadyExists?: boolean }> => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      // `brand` records which brand the user signed up on; the Supabase auth
      // email templates branch on it ({{ .Data.brand }}) and backend emails
      // can use it as the per-user brand signal.
      options: { emailRedirectTo: window.location.origin, data: { full_name: displayName, brand: BRAND.id } },
    });
    if (error) { handleAuthError(error); throw error; }
    if (data.user?.identities?.length === 0) {
      return { success: false, alreadyExists: true };
    }
    return { success: true };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) { handleAuthError(error); throw error; }
  };

  const signInWithOAuth = async (provider: "google" | "github") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider, options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) { handleAuthError(error); throw error; }
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) { handleAuthError(error); throw error; }
    toast({ title: "Password reset email sent", description: "Check your email for the reset link." });
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { handleAuthError(error); throw error; }
    toast({ title: "Password updated", description: "Your password has been changed successfully." });
  };

  return (
    <AuthContext.Provider
      value={{ user, session, profile, role, loading, roleLoading, signIn, signUp, signOut, signInWithOAuth, resetPassword, updatePassword, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
