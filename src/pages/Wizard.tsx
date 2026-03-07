import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  User,
  Target,
  Eye,
  PartyPopper,
  Check,
  Upload,
  BookOpen,
  Layers,
  Zap,
  BarChart3,
  Users,
  FileText,
  Palette,
  Code,
  SkipForward,
} from "lucide-react";
import confetti from "canvas-confetti";

const WIZARD_KEY = "menerio-wizard-completed";

const STEPS = [
  { id: "welcome", label: "Welcome", icon: Sparkles },
  { id: "profile", label: "Profile", icon: User },
  { id: "focus", label: "Focus", icon: Target },
  { id: "tour", label: "Tour", icon: Eye },
  { id: "ready", label: "Ready", icon: PartyPopper },
];

const FOCUS_OPTIONS = [
  { id: "project-management", label: "Project Management", icon: Layers, description: "Organize and track projects" },
  { id: "content-creation", label: "Content Creation", icon: FileText, description: "Create and manage content" },
  { id: "design", label: "Design & Creative", icon: Palette, description: "Design workflows and assets" },
  { id: "development", label: "Development", icon: Code, description: "Code and technical projects" },
  { id: "analytics", label: "Analytics & Data", icon: BarChart3, description: "Data analysis and insights" },
  { id: "team-collab", label: "Team Collaboration", icon: Users, description: "Collaborate with your team" },
];

const TOUR_FEATURES = [
  { icon: Layers, title: "Smart Library", description: "Organize everything in one place with AI-powered categorization and instant search." },
  { icon: Sparkles, title: "AI Assistant", description: "Get intelligent suggestions, auto-completions, and content generation powered by AI." },
  { icon: BarChart3, title: "Insights Dashboard", description: "Track your progress with beautiful analytics and actionable insights." },
  { icon: Zap, title: "Quick Actions", description: "Accomplish tasks in seconds with keyboard shortcuts and smart workflows." },
];

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -80 : 80, opacity: 0 }),
};

export default function Wizard() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);

  // Profile fields
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Focus
  const [selectedFocus, setSelectedFocus] = useState<string[]>([]);

  // Already completed check
  useEffect(() => {
    if (localStorage.getItem(WIZARD_KEY) === "true") {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  // Pre-fill profile
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setBio(profile.bio || "");
      setAvatarUrl(profile.avatar_url);
    }
  }, [profile]);

  const goNext = () => {
    if (step < STEPS.length - 1) {
      setDirection(1);
      setStep((s) => s + 1);
    }
  };

  const goBack = () => {
    if (step > 0) {
      setDirection(-1);
      setStep((s) => s - 1);
    }
  };

  const complete = useCallback(() => {
    localStorage.setItem(WIZARD_KEY, "true");
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  const skipWizard = () => {
    localStorage.setItem(WIZARD_KEY, "true");
    navigate("/dashboard", { replace: true });
  };

  const saveProfile = async () => {
    if (!user) return;
    await supabase.from("profiles").update({
      display_name: displayName || null,
      bio: bio || null,
      avatar_url: avatarUrl,
    }).eq("id", user.id);
    await refreshProfile();
    goNext();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (!error) {
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
    }
    setUploading(false);
  };

  const saveFocus = () => {
    localStorage.setItem("menerio-user-focus", JSON.stringify(selectedFocus));
    goNext();
  };

  const toggleFocus = (id: string) => {
    setSelectedFocus((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  // Confetti on reaching last step
  useEffect(() => {
    if (step === STEPS.length - 1) {
      const timer = setTimeout(() => {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const userName = profile?.display_name || user?.email?.split("@")[0] || "there";
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
            <span className="text-xs font-bold text-primary-foreground">M</span>
          </div>
          <span className="text-sm font-semibold font-display text-foreground">Menerio</span>
        </div>
        <Button variant="ghost" size="sm" onClick={skipWizard} className="text-muted-foreground gap-1">
          <SkipForward className="h-3.5 w-3.5" /> Skip setup
        </Button>
      </header>

      {/* Progress */}
      <div className="px-6 pt-6 max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <div key={s.id} className="flex items-center gap-2 flex-1">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                    isDone
                      ? "bg-primary text-primary-foreground"
                      : isActive
                        ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 rounded-full transition-colors ${isDone ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-1">
          Step {step + 1} of {STEPS.length} — {STEPS[step].label}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              {/* Step 0 — Welcome */}
              {step === 0 && (
                <div className="text-center space-y-6">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
                    <Sparkles className="h-10 w-10 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-display font-bold">Welcome, {userName}!</h2>
                    <p className="text-muted-foreground mt-3 max-w-md mx-auto">
                      Menerio helps you organize, create, and collaborate smarter with AI. Let's set up your workspace in under a minute.
                    </p>
                  </div>
                  <Button size="lg" onClick={goNext} className="gap-2">
                    Let's get started <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Step 1 — Profile */}
              {step === 1 && (
                <div className="space-y-6 max-w-md mx-auto">
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Complete Your Profile</h2>
                    <p className="text-sm text-muted-foreground mt-1">Help others recognize you.</p>
                  </div>

                  <div className="flex flex-col items-center gap-4">
                    <div className="relative group">
                      <Avatar className="h-24 w-24">
                        <AvatarImage src={avatarUrl || undefined} />
                        <AvatarFallback className="text-2xl bg-muted">
                          {displayName?.[0]?.toUpperCase() || <User className="h-8 w-8" />}
                        </AvatarFallback>
                      </Avatar>
                      <label className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-foreground/40 opacity-0 transition-opacity group-hover:opacity-100">
                        <Upload className="h-5 w-5 text-primary-foreground" />
                        <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploading} />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">{uploading ? "Uploading…" : "Click to upload"}</p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">Display Name</label>
                      <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How should we call you?" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">Bio <span className="text-muted-foreground font-normal">(optional)</span></label>
                      <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A short intro about you" rows={3} />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={goBack} className="gap-1"><ArrowLeft className="h-4 w-4" /> Back</Button>
                    <Button className="flex-1 gap-1" onClick={saveProfile}>Save & Continue <ArrowRight className="h-4 w-4" /></Button>
                    <Button variant="ghost" onClick={goNext} className="text-muted-foreground">Skip</Button>
                  </div>
                </div>
              )}

              {/* Step 2 — Focus */}
              {step === 2 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Choose Your Focus</h2>
                    <p className="text-sm text-muted-foreground mt-1">Select what you'll primarily use Menerio for. Pick as many as you like.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {FOCUS_OPTIONS.map((opt) => {
                      const selected = selectedFocus.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          onClick={() => toggleFocus(opt.id)}
                          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                            selected
                              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                              : "border-border hover:border-primary/40 hover:bg-accent"
                          }`}
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                            <opt.icon className="h-4.5 w-4.5" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{opt.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                          </div>
                          {selected && (
                            <Check className="ml-auto h-4 w-4 shrink-0 text-primary mt-0.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={goBack} className="gap-1"><ArrowLeft className="h-4 w-4" /> Back</Button>
                    <Button className="flex-1 gap-1" onClick={saveFocus}>Continue <ArrowRight className="h-4 w-4" /></Button>
                    <Button variant="ghost" onClick={goNext} className="text-muted-foreground">Skip</Button>
                  </div>
                </div>
              )}

              {/* Step 3 — Tour */}
              {step === 3 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-2xl font-display font-bold">Quick Tour</h2>
                    <p className="text-sm text-muted-foreground mt-1">Here's what you can do with Menerio.</p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {TOUR_FEATURES.map((f) => (
                      <Card key={f.title} className="border bg-card">
                        <CardContent className="pt-6 flex flex-col items-center text-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                            <f.icon className="h-6 w-6 text-primary" />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold font-display">{f.title}</h4>
                            <p className="text-xs text-muted-foreground mt-1">{f.description}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={goBack} className="gap-1"><ArrowLeft className="h-4 w-4" /> Back</Button>
                    <Button className="flex-1 gap-1" onClick={goNext}>
                      <BookOpen className="h-4 w-4" /> Continue
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4 — Ready */}
              {step === 4 && (
                <div className="text-center space-y-6">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-success/10">
                    <PartyPopper className="h-10 w-10 text-success" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-display font-bold">You're all set! 🎉</h2>
                    <p className="text-muted-foreground mt-3 max-w-md mx-auto">
                      Your workspace is ready. Start creating, exploring, and building something amazing.
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-3">
                    <Button size="lg" onClick={complete} className="gap-2">
                      Go to Dashboard <ArrowRight className="h-4 w-4" />
                    </Button>
                    <div className="flex gap-4 text-sm">
                      <a href="/docs" className="text-primary hover:underline flex items-center gap-1">
                        <BookOpen className="h-3.5 w-3.5" /> Documentation
                      </a>
                      <a href="/features" className="text-primary hover:underline flex items-center gap-1">
                        <Zap className="h-3.5 w-3.5" /> Features
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
