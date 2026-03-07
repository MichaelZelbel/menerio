import { useState, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Loader2, Camera, Eye, EyeOff, AlertTriangle, Trash2, User, Shield, CreditCard, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { CreditsDisplay } from "@/components/settings/CreditsDisplay";

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

export default function Settings() {
  const { user, profile, role, updatePassword, refreshProfile, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Profile state
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [website, setWebsite] = useState(profile?.website || "");
  const [profileLoading, setProfileLoading] = useState(false);

  // Avatar state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const initials = (profile?.display_name || user?.email || "U")
    .split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  const avatarPublicUrl = profile?.avatar_url
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_url).data.publicUrl
    : null;

  // ── Profile save ──
  const handleSaveProfile = async () => {
    if (!user) return;
    setProfileLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName, bio, website })
      .eq("id", user.id);
    if (error) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update profile." });
    } else {
      await refreshProfile();
      toast({ title: "Profile updated", description: "Your changes have been saved." });
    }
    setProfileLoading(false);
  };

  // ── Avatar upload ──
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      toast({ variant: "destructive", title: "Invalid file", description: "Please upload a JPG, PNG, GIF, or WebP image." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "Maximum file size is 2MB." });
      return;
    }

    setAvatarUploading(true);

    // Delete old avatar if exists
    if (profile?.avatar_url) {
      await supabase.storage.from("avatars").remove([profile.avatar_url]);
    }

    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
      cacheControl: "3600",
      upsert: true,
    });

    if (uploadError) {
      toast({ variant: "destructive", title: "Upload failed", description: uploadError.message });
      setAvatarUploading(false);
      return;
    }

    await supabase.from("profiles").update({ avatar_url: path }).eq("id", user.id);
    await refreshProfile();
    toast({ title: "Avatar updated" });
    setAvatarUploading(false);
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
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== "DELETE") return;
    setDeleteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("delete-my-account", {
        body: { password: deletePassword },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (res.error || res.data?.error) {
        toast({ variant: "destructive", title: "Error", description: res.data?.error || "Failed to delete account." });
        setDeleteLoading(false);
        return;
      }

      await signOut();
      navigate("/");
      toast({ title: "Account deleted", description: "Your account has been permanently deleted." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Something went wrong." });
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
    }
  };

  const roleInfo = ROLE_LABELS[role || "free"];

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="profile" className="gap-1.5 text-xs"><User className="h-3.5 w-3.5 hidden sm:block" /> Profile</TabsTrigger>
          <TabsTrigger value="avatar" className="gap-1.5 text-xs"><Camera className="h-3.5 w-3.5 hidden sm:block" /> Avatar</TabsTrigger>
          <TabsTrigger value="account" className="gap-1.5 text-xs"><Shield className="h-3.5 w-3.5 hidden sm:block" /> Account</TabsTrigger>
          <TabsTrigger value="subscription" className="gap-1.5 text-xs"><CreditCard className="h-3.5 w-3.5 hidden sm:block" /> Plan</TabsTrigger>
          <TabsTrigger value="danger" className="gap-1.5 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5 hidden sm:block" /> Danger</TabsTrigger>
        </TabsList>

        {/* ── Profile Tab ── */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your public profile details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 mb-2">
                <Avatar className="h-16 w-16">
                  {avatarPublicUrl && <AvatarImage src={avatarPublicUrl} />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-lg">{initials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-foreground">{profile?.display_name || "No name set"}</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">Bio <span className="text-muted-foreground">({bio.length}/160)</span></Label>
                <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value.slice(0, 160))} placeholder="Tell us about yourself" rows={3} maxLength={160} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
              </div>
              <Button onClick={handleSaveProfile} disabled={profileLoading}>
                {profileLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Avatar Tab ── */}
        <TabsContent value="avatar">
          <Card>
            <CardHeader>
              <CardTitle>Profile Picture</CardTitle>
              <CardDescription>Upload a new avatar. JPG, PNG, GIF, or WebP. Max 2MB.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
              <div
                className="relative group cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Avatar className="h-32 w-32">
                  {avatarPublicUrl && <AvatarImage src={avatarPublicUrl} />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-3xl">{initials}</AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  {avatarUploading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-background" />
                  ) : (
                    <Camera className="h-8 w-8 text-background" />
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
              </div>
              <p className="text-sm text-muted-foreground">Click the avatar to upload a new picture</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Account Tab ── */}
        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account Security</CardTitle>
              <CardDescription>Manage your email and password.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={user?.email || ""} disabled className="bg-muted" />
                <p className="text-xs text-muted-foreground">Contact support to change your email.</p>
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
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
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
        </TabsContent>

        {/* ── Subscription Tab ── */}
        <TabsContent value="subscription">
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
              <CardDescription>Your current plan and billing details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge variant={role === "free" ? "secondary" : "success"} className="text-sm px-3 py-1">
                  {roleInfo.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{roleInfo.description}</p>
              {role === "free" && (
                <Button className="mt-2">Upgrade to Premium</Button>
              )}
            </CardContent>
          </Card>
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
                  <li>Your profile and avatar</li>
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
                        <Label htmlFor="delPw">Enter your password to confirm</Label>
                        <Input id="delPw" type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Your password" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="delConfirm">Type <span className="font-mono font-bold text-destructive">DELETE</span> to confirm</Label>
                        <Input id="delConfirm" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="DELETE" />
                      </div>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeleteAccount}
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
