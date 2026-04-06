import { useState, useMemo } from "react";
import { MailCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import logoImg from "@/assets/logo.png";

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
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < strength ? colors[strength - 1] : "bg-muted"
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Password strength: {labels[strength - 1] || "Too short"}
      </p>
    </div>
  );
}

export default function Auth() {
  const { signIn, signUp, signInWithOAuth, resetPassword, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/dashboard";
  const defaultTab = searchParams.get("tab") === "signup" ? "signup" : "signin";

  // Redirect if already logged in
  if (session) {
    navigate(redirectTo, { replace: true });
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-flex items-center gap-2 mb-4">
            <img src={logoImg} alt="Menerio" className="h-10 w-10 object-contain" />
          </Link>
          <h1 className="text-2xl font-bold font-display">Welcome to Menerio</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account or create a new one</p>
        </div>

        <Card>
          <Tabs defaultValue={defaultTab}>
            <CardHeader className="pb-2">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="pt-4">
              {/* OAuth buttons hidden until providers are configured */}

              <TabsContent value="signin" className="mt-0">
                <SignInForm onSuccess={() => navigate(redirectTo, { replace: true })} />
              </TabsContent>
              <TabsContent value="signup" className="mt-0">
                <SignUpForm />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const { signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      onSuccess();
    } catch {
      // Error handled in context
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await resetPassword(email);
      setForgotMode(false);
    } catch {
      // Error handled in context
    } finally {
      setLoading(false);
    }
  };

  if (forgotMode) {
    return (
      <form onSubmit={handleReset} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reset-email">Email</Label>
          <Input id="reset-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send Reset Link
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => setForgotMode(false)}>
          Back to sign in
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSignIn} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signin-email">Email</Label>
        <Input id="signin-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="signin-password">Password</Label>
          <button type="button" onClick={() => setForgotMode(true)} className="text-xs text-primary hover:underline">
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <Input id="signin-password" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign In
      </Button>
    </form>
  );
}

function SignUpForm() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) return;
    if (!accepted) return;
    setLoading(true);
    try {
      await signUp(email, password, displayName);
      setSubmitted(true);
    } catch {
      // Error handled in context
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center text-center py-6 space-y-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <MailCheck className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold font-display">Check your email</h3>
          <p className="text-sm text-muted-foreground max-w-xs">
            We've sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Click the link in that email to activate your account.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground space-y-1 max-w-xs">
          <p>Didn't receive it? Check your spam folder.</p>
          <p>The link expires after 24 hours.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSignUp} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signup-name">Display Name</Label>
        <Input id="signup-name" placeholder="John Doe" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input id="signup-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <div className="relative">
          <Input id="signup-password" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <PasswordStrength password={password} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-confirm">Confirm Password</Label>
        <Input id="signup-confirm" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        {confirmPassword && password !== confirmPassword && (
          <p className="text-xs text-destructive">Passwords do not match</p>
        )}
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="terms" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} />
        <Label htmlFor="terms" className="text-xs text-muted-foreground leading-tight">
          I agree to the <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link> and <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
        </Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading || !accepted || password !== confirmPassword}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Create Account
      </Button>
    </form>
  );
}
