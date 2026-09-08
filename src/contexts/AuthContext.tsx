import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Session, User, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { clearPersistedQueries } from "@/lib/query-persister";
import { BRAND } from "@/lib/brand";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAccountQueryClient } from "@/lib/account-query-client";
import { installQuerySyncListener } from "@/lib/query-sync";
import { OFFLINE_CORE } from "@/lib/flags";
import { getDb } from "@/sync/db";

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
  const generation = useRef(0);
  const owner = useRef<string | null | undefined>(undefined);
  const [cache, setCache] = useState(() => createAccountQueryClient(null));
  const cacheRef = useRef(cache);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);
  const [transitionError, setTransitionError] = useState(false);
  const { toast } = useToast();

  const fetchProfile = useCallback(async (userId: string, epoch = generation.current) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", userId)
      .single();
    if (!error && data && epoch === generation.current && owner.current === userId) setProfile(data as Profile);
  }, []);

  const fetchRole = useCallback(async (userId: string, epoch = generation.current) => {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .single();
      if (!error && data && epoch === generation.current && owner.current === userId) {
        setRole(data.role as AppRole);
      }
    } finally {
      if (epoch === generation.current && owner.current === userId) setRoleLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      setRoleLoading(true);
      const epoch = generation.current;
      await fetchProfile(user.id, epoch);
      await fetchRole(user.id, epoch);
    }
  }, [user, fetchProfile, fetchRole]);

  useEffect(() => {
    let disposed = false;
    let receivedEvent = false;
    let cleanup = Promise.resolve();
    const transition = (newSession: Session | null) => {
      const nextOwner = newSession?.user.id ?? null;
      if (owner.current === nextOwner) {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        return;
      }
      const epoch = ++generation.current;
      const previousOwner = owner.current;
      owner.current = nextOwner;
      setLoading(true);
      setTransitionError(false);
      setProfile(null);
      setRole(null);
      setRoleLoading(!!nextOwner);
      // Start cancellation immediately. Serialize disk cleanup across rapid events.
      const retired = cacheRef.current.retire();
      cleanup = cleanup.catch(() => {}).then(async () => {
        await retired;
        if (previousOwner) await clearPersistedQueries(previousOwner);
        if (OFFLINE_CORE) {
          const localOwner = localStorage.getItem("menerio:powersync-user");
          if (localOwner !== nextOwner) await getDb().disconnectAndClear();
          if (nextOwner) localStorage.setItem("menerio:powersync-user", nextOwner);
          else localStorage.removeItem("menerio:powersync-user");
        }
        if (disposed || epoch !== generation.current) return;
        const nextCache = createAccountQueryClient(nextOwner);
        cacheRef.current = nextCache;
        setCache(nextCache);
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);
        if (nextOwner) {
          localStorage.setItem(LAST_USER_KEY, nextOwner);
          void navigator.storage?.persist?.();
          // Outside the synchronous auth callback to avoid Supabase auth locking.
          void fetchProfile(nextOwner, epoch);
          void fetchRole(nextOwner, epoch);
        }
      }).catch(() => {
        // Keep children unmounted when cleanup fails. Never expose the old store.
        if (!disposed && epoch === generation.current) { setLoading(true); setTransitionError(true); }
      });
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      receivedEvent = true;
      transition(newSession);
    });
    void supabase.auth.getSession().then(({ data: { session: existingSession } }) => {
      if (!receivedEvent && !disposed) transition(existingSession);
    });
    return () => { disposed = true; generation.current++; owner.current = undefined; subscription.unsubscribe(); };
  }, [fetchProfile, fetchRole]);

  useEffect(() => installQuerySyncListener(cache.client), [cache]);

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
      {loading ? <div role="status">{transitionError ? <>Your account could not be opened safely. <button onClick={() => window.location.reload()}>Try again</button></> : "Loading your account..."}</div> : (
        <QueryClientProvider client={cache.client} key={user?.id ?? "anonymous"}>
          {children}
        </QueryClientProvider>
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
