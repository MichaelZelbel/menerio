import { useState, useMemo, useEffect } from "react";
import { openConsentSettings } from "@/lib/consent";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLogActivity } from "@/hooks/useLogActivity";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Eye, EyeOff, AlertTriangle, Trash2, User, Shield, CreditCard, Settings as SettingsIcon, Sparkles, Plug, MessageSquare, Brain, Import, Bell, Send, Gamepad2, Github, Key, Globe, HardDrive } from "lucide-react";
import { CreditsDisplay } from "@/components/settings/CreditsDisplay";
import { AppIntegrations } from "@/components/settings/AppIntegrations";
import { SlackIntegration } from "@/components/settings/SlackIntegration";
import { TelegramIntegration } from "@/components/settings/TelegramIntegration";
import { DiscordIntegration } from "@/components/settings/DiscordIntegration";
import { MCPConnectionManager } from "@/components/settings/MCPConnectionManager";
import { UserMcpServersManager } from "@/components/settings/UserMcpServersManager";
import { ImportMigrate } from "@/components/settings/ImportMigrate";
import { NotificationPreferences } from "@/components/settings/NotificationPreferences";
import { GitHubSyncSettings } from "@/components/settings/GitHubSyncSettings";
import { GoogleDriveScans } from "@/components/settings/GoogleDriveScans";

import { LocalReplicaPanel } from "@/components/settings/LocalReplicaPanel";

import { ApiKeysManager } from "@/components/settings/ApiKeysManager";
import { ConnectedGodspeedsCard } from "@/components/settings/ConnectedGodspeedsCard";
import { AISuggestionPreferences } from "@/components/settings/AISuggestionPreferences";
import { SingleFileIntegration } from "@/components/settings/SingleFileIntegration";
import { IntegrationsOverview } from "@/components/settings/IntegrationsOverview";
import { AiVisibilitySettings } from "@/components/settings/AiVisibilitySettings";
import { StaffAccessCard } from "@/components/settings/StaffAccessCard";
import { BRAND } from "@/lib/brand";
import { functionErrorMessage } from "@/lib/function-error";

function PasswordStrength({ password }: { password: string }) {
  const strength = useMemo(() => {
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  }, [password]);
  const labels = ["Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-destructive", "bg-warning", "bg-info", "bg-success"];
  if (!password) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i < strength ? colors[strength - 1] : "bg-muted"}`} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Password strength: {labels[strength - 1] || "Too short"}</p>
    </div>
  );
}

const ROLE_LABELS: Record<string, { label: string; description: string }> = {
  free: { label: "Free", description: "Basic access to all core features." },
  premium: { label: "Premium", description: "Full access to all features including priority support." },
  premium_gift: { label: "Premium (Gift)", description: "Premium access via a gift subscription." },
  admin: { label: "Admin", description: "Full administrative access." },
};

const SETTINGS_TABS = [
  "account", "godspeed", "import", "notifications", "ai-suggestions", "ai-visibility",
  "connections", "mcp", "integrations", "telegram", "discord", "singlefile", "github", "gdrive",
  "apikeys", "credits", "subscription", "danger",
];

export default function Settings() {
  const { user, profile, role, updatePassword, refreshProfile, signOut } = useAuth();
  const { toast } = useToast();
  const { logActivity } = useLogActivity();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // The URL is the only source of the tab: links to ?tab=... from inside
  // Settings (the Web Clipper's "API keys" link, the sidebar's "Connect AI",
  // the credits banner) change the search params without remounting the page,
  // and a copy in state never heard about them.
  // An unknown ?tab= (an old bookmark, a mistyped link) rendered an empty
  // page with no tab selected; fall back to Account instead.
  const requestedTab = searchParams.get("tab");
  const activeTab = requestedTab && SETTINGS_TABS.includes(requestedTab) ? requestedTab : "account";

  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  };

  // Profile state
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [profileLoading, setProfileLoading] = useState(false);

  // Resync the field once the profile finishes loading. `profile` is null on a
  // direct load / hard refresh (AuthContext fetches it async), so without this
  // the input stays empty and "Save Name" would overwrite the real name with "".
  useEffect(() => {
    setDisplayName(profile?.display_name || "");
  }, [profile?.display_name]);

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete account state
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // ── Profile save ──
  const handleSaveProfile = async () => {
    if (!user) return;
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast({ variant: "destructive", title: "Name required", description: "Display name can't be empty." });
      return;
    }
    setProfileLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed })
      .eq("id", user.id);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update profile." });
    } else {
      await refreshProfile();
      logActivity("profile_update", "profile", user.id, { fields: ["display_name"] });
      toast({ title: "Profile updated", description: "Your changes have been saved." });
    }
    setProfileLoading(false);
  };

  // ── Password change ──
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) return;
    setPasswordLoading(true);
    try {
      await updatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      // handled in context
    } finally {
      setPasswordLoading(false);
    }
  };

  // ── Delete account ──
  // An account that only ever signed in with Google or GitHub has no password
  // to re-enter; it confirms by typing its e-mail address instead.
  const hasPassword = (user?.identities ?? []).some((i) => i.provider === "email");
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("delete-my-account", {
        body: hasPassword ? { password: deletePassword } : { confirm_email: deletePassword },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (res.error || res.data?.error) {
        // On a refusal `data` is null and the function's answer ("Invalid
        // password", an e-mail that does not match) sits in the error's
        // context; `res.data?.error` never named it.
        const fallback = "Could not delete the account. Try again.";
        const description = res.error ? await functionErrorMessage(res.error, fallback) : fallback;
        toast({ variant: "destructive", title: "Account not deleted", description });
        setDeleteLoading(false);
        return;
      }

      setDeleteDialogOpen(false);
      await signOut();
      navigate("/");
      toast({ title: "Account deleted", description: "Your account has been permanently deleted." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Something went wrong." });
    } finally {
      setDeleteLoading(false);
    }
  };

  const roleInfo = ROLE_LABELS[role || "free"];

  return (
    <div className="max-w-2xl">
      <SEOHead title="Settings — Menerio" noIndex />
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="flex flex-wrap gap-1 h-auto p-1">
          <TabsTrigger value="account" className="gap-1.5 text-xs"><Shield className="h-3.5 w-3.5 hidden sm:block" /> Account</TabsTrigger>
          <TabsTrigger value="godspeed" className="gap-1.5 text-xs"><Plug className="h-3.5 w-3.5 hidden sm:block" /> Integrations</TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5 text-xs"><Import className="h-3.5 w-3.5 hidden sm:block" /> Import</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5 text-xs"><Bell className="h-3.5 w-3.5 hidden sm:block" /> Alerts</TabsTrigger>
          <TabsTrigger value="ai-suggestions" className="gap-1.5 text-xs"><Brain className="h-3.5 w-3.5 hidden sm:block" /> AI Suggestions</TabsTrigger>
          <TabsTrigger value="ai-visibility" className="gap-1.5 text-xs"><EyeOff className="h-3.5 w-3.5 hidden sm:block" /> AI Visibility</TabsTrigger>
          <TabsTrigger value="connections" className="gap-1.5 text-xs"><Plug className="h-3.5 w-3.5 hidden sm:block" /> Apps</TabsTrigger>
          <TabsTrigger value="mcp" className="gap-1.5 text-xs"><Brain className="h-3.5 w-3.5 hidden sm:block" /> MCP</TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1.5 text-xs"><MessageSquare className="h-3.5 w-3.5 hidden sm:block" /> Slack</TabsTrigger>
          <TabsTrigger value="telegram" className="gap-1.5 text-xs"><Send className="h-3.5 w-3.5 hidden sm:block" /> Telegram</TabsTrigger>
          <TabsTrigger value="discord" className="gap-1.5 text-xs"><Gamepad2 className="h-3.5 w-3.5 hidden sm:block" /> Discord</TabsTrigger>
          <TabsTrigger value="singlefile" className="gap-1.5 text-xs"><Globe className="h-3.5 w-3.5 hidden sm:block" /> Web Clipper</TabsTrigger>
          <TabsTrigger value="github" className="gap-1.5 text-xs"><Github className="h-3.5 w-3.5 hidden sm:block" /> GitHub</TabsTrigger>
          <TabsTrigger value="gdrive" className="gap-1.5 text-xs"><HardDrive className="h-3.5 w-3.5 hidden sm:block" /> Drive Scans</TabsTrigger>

          <TabsTrigger value="apikeys" className="gap-1.5 text-xs"><Key className="h-3.5 w-3.5 hidden sm:block" /> API Keys</TabsTrigger>
          <TabsTrigger value="credits" className="gap-1.5 text-xs"><Sparkles className="h-3.5 w-3.5 hidden sm:block" /> Credits</TabsTrigger>
          <TabsTrigger value="subscription" className="gap-1.5 text-xs"><CreditCard className="h-3.5 w-3.5 hidden sm:block" /> Plan</TabsTrigger>
          <TabsTrigger value="danger" className="gap-1.5 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5 hidden sm:block" /> Danger</TabsTrigger>
        </TabsList>

        {/* ── Account Tab ── */}
        <TabsContent value="account" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Update your display name and manage your account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
              </div>
              <Button onClick={handleSaveProfile} disabled={profileLoading} size="sm">
                {profileLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Name
              </Button>
              <Separator />
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={user?.email || ""} disabled className="bg-muted" />
                <p className="text-xs text-muted-foreground">
                  To change your email, write to{" "}
                  <a href={`mailto:${BRAND.supportEmail}`} className="text-primary hover:underline">{BRAND.supportEmail}</a>.
                </p>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Cookies</Label>
                <p className="text-xs text-muted-foreground">Change or withdraw your cookie choice for this browser.</p>
                <Button variant="outline" size="sm" onClick={openConsentSettings}>Cookie settings</Button>
              </div>
              <Separator />
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <h4 className="font-medium text-foreground">Change Password</h4>
                <div className="space-y-2">
                  <Label htmlFor="newPw">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPw"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={8}
                    />
                    <button aria-label={showPassword ? "Hide password" : "Show password"} type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <PasswordStrength password={newPassword} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPw">Confirm New Password</Label>
                  <Input id="confirmPw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  )}
                </div>
                <Button type="submit" disabled={passwordLoading || newPassword !== confirmPassword || newPassword.length < 8}>
                  {passwordLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update Password
                </Button>
              </form>
            </CardContent>
          </Card>
          <StaffAccessCard />
        </TabsContent>

        {/* ── Integrations Tab ── */}
        <TabsContent value="godspeed" className="space-y-6">
          <IntegrationsOverview onOpenTab={handleTabChange} />
          <ConnectedGodspeedsCard />
        </TabsContent>

        {/* ── Import Tab ── */}
        <TabsContent value="import">
          <ImportMigrate />
        </TabsContent>

        {/* ── Notifications Tab ── */}
        <TabsContent value="notifications">
          <NotificationPreferences />
        </TabsContent>

        <TabsContent value="ai-suggestions">
          <AISuggestionPreferences />
        </TabsContent>

        <TabsContent value="ai-visibility">
          <AiVisibilitySettings />
        </TabsContent>



        <TabsContent value="credits">
          <CreditsDisplay />
        </TabsContent>

        {/* ── Subscription Tab ── */}
        <TabsContent value="subscription">
          <Card>
            <CardHeader>
              <CardTitle>Your Plan</CardTitle>
              <CardDescription>Your current role and access level.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge variant={role === "free" ? "secondary" : "success"} className="text-sm px-3 py-1">
                  {roleInfo.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{roleInfo.description}</p>
              {(role === "premium" || role === "premium_gift" || role === "admin") && (
                <p className="text-sm text-muted-foreground">
                  Your plan is active and managed by an administrator.
                </p>
              )}
              {role === "free" && (
                <p className="text-sm text-muted-foreground">
                  Premium access can be granted by an administrator. Contact your admin to request access.
                </p>
              )}
              <Separator />
              <div>
                <p className="text-sm font-medium mb-1">AI Credits</p>
                <p className="text-xs text-muted-foreground">
                  View your detailed AI credit usage in the{" "}
                  <button type="button" onClick={() => handleTabChange("credits")} className="text-primary hover:underline">Credits tab</button>.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Connections Tab ── */}
        <TabsContent value="connections">
          <AppIntegrations />
        </TabsContent>

        {/* ── MCP Tab ── */}
        <TabsContent value="mcp" className="space-y-6">
          <MCPConnectionManager />
          <UserMcpServersManager />
        </TabsContent>

        {/* ── Slack Integration Tab ── */}
        <TabsContent value="integrations">
          <SlackIntegration />
        </TabsContent>

        {/* ── Telegram Integration Tab ── */}
        <TabsContent value="telegram">
          <TelegramIntegration />
        </TabsContent>

        {/* ── Discord Integration Tab ── */}
        <TabsContent value="discord">
          <DiscordIntegration />
        </TabsContent>

        {/* ── SingleFile Web Clipper Tab ── */}
        <TabsContent value="singlefile">
          <SingleFileIntegration />
        </TabsContent>

        {/* ── GitHub Sync Tab ── */}
        <TabsContent value="github" className="space-y-4">
          <LocalReplicaPanel />
          <GitHubSyncSettings />
        </TabsContent>

        {/* ── Google Drive Scans Tab ── */}
        <TabsContent value="gdrive">
          <GoogleDriveScans />
        </TabsContent>




        {/* ── API Keys Tab ── */}
        <TabsContent value="apikeys">
          <ApiKeysManager />
        </TabsContent>

        {/* ── Danger Zone Tab ── */}
        <TabsContent value="danger">
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> Danger Zone
              </CardTitle>
              <CardDescription>Irreversible and destructive actions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <h4 className="font-medium text-destructive mb-1">Delete Account</h4>
                <p className="text-sm text-muted-foreground mb-1">Permanently delete your account and all associated data:</p>
                <ul className="text-sm text-muted-foreground list-disc list-inside mb-4 space-y-0.5">
                  <li>Your profile</li>
                  <li>Your role and permissions</li>
                  <li>All associated data</li>
                </ul>
                <p className="text-xs text-destructive font-medium mb-3">This action cannot be undone.</p>

                <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Delete Account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="text-destructive">Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete your account, profile, and all associated data. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label htmlFor="delPw">{hasPassword ? "Enter your password to confirm" : "Type your e-mail address to confirm"}</Label>
                        <Input
                          id="delPw"
                          type={hasPassword ? "password" : "email"}
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          placeholder={hasPassword ? "Your password" : user?.email ?? "you@example.com"}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="delConfirm">Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm</Label>
                        <Input id="delConfirm" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
                      </div>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          // AlertDialogAction closes the dialog on click, which
                          // hid the spinner and, on a wrong password, threw the
                          // typed confirmation away. Close only on success.
                          e.preventDefault();
                          void handleDeleteAccount();
                        }}
                        disabled={deleteLoading || deleteConfirmText !== "DELETE" || !deletePassword}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Permanently Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
