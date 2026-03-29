import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Wrench,
  RefreshCw,
  Brain,
  Users,
  Check,
  Loader2,
  Lightbulb,
  X,
} from "lucide-react";

const TOOL_OPTIONS = [
  "Slack",
  "Email",
  "Calendar",
  "Project management (Jira, Linear, Asana)",
  "Code editor (VS Code, Cursor)",
  "Notion / Docs",
  "CRM",
];

const ONBOARDING_KEY = "menerio-first-captures-done";

interface Suggestion {
  text: string;
  saved: boolean;
  saving: boolean;
}

const slideVariants = {
  enter: { x: 60, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -60, opacity: 0 },
};

export function FirstCapturesWizard({ onComplete }: { onComplete: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [tools, setTools] = useState<string[]>([]);
  const [decisions, setDecisions] = useState("");
  const [reExplaining, setReExplaining] = useState("");
  const [keyPeople, setKeyPeople] = useState("");

  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const totalSteps = 5; // 4 questions + suggestions

  const toggleTool = (tool: string) => {
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const generateSuggestions = useCallback(async () => {
    if (!user) return;
    setGenerating(true);

    const context = [
      tools.length > 0 ? `Daily tools: ${tools.join(", ")}` : "",
      decisions ? `Repeated decisions: ${decisions}` : "",
      reExplaining ? `Re-explaining to AI: ${reExplaining}` : "",
      keyPeople ? `Key people: ${keyPeople}` : "",
    ].filter(Boolean).join("\n");

    // Generate suggestions locally based on user input (no LLM needed for this)
    const generated: string[] = [];

    // From tools
    tools.forEach((tool) => {
      generated.push(`My preferred workflow tool for daily work: ${tool}`);
    });

    // From decisions
    if (decisions) {
      decisions.split(/[,\n]/).map((d) => d.trim()).filter(Boolean).forEach((d) => {
        generated.push(`Recurring decision I make: ${d}`);
      });
    }

    // From re-explaining
    if (reExplaining) {
      reExplaining.split(/[,\n]/).map((r) => r.trim()).filter(Boolean).forEach((r) => {
        generated.push(`Context I always re-explain to AI: ${r}`);
      });
    }

    // From key people
    if (keyPeople) {
      keyPeople.split(/[,\n]/).map((p) => p.trim()).filter(Boolean).forEach((p) => {
        generated.push(`Key person in my work: ${p}`);
      });
    }

    // Add some universal suggestions
    const universals = [
      "My current main project and its goals",
      "My role and key responsibilities",
      "How I prefer to communicate (sync vs async)",
      "My biggest current challenge at work",
      "The decision framework I use most often",
    ];

    universals.forEach((u) => {
      if (generated.length < 20) generated.push(u);
    });

    setSuggestions(generated.slice(0, 20).map((text) => ({ text, saved: false, saving: false })));
    setGenerating(false);
  }, [user, tools, decisions, reExplaining, keyPeople]);

  const saveSuggestion = async (index: number) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setSuggestions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, saving: true } : s))
    );

    try {
      const res = await supabase.functions.invoke("quick-capture", {
        body: { content: suggestions[index].text, source: "onboarding" },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error || res.data?.error) throw new Error("Failed");

      setSuggestions((prev) =>
        prev.map((s, i) => (i === index ? { ...s, saved: true, saving: false } : s))
      );
    } catch {
      setSuggestions((prev) =>
        prev.map((s, i) => (i === index ? { ...s, saving: false } : s))
      );
      toast({ variant: "destructive", title: "Failed to save" });
    }
  };

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    onComplete();
  };

  const goNext = () => {
    if (step === 3) {
      generateSuggestions();
    }
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  };

  const savedCount = suggestions.filter((s) => s.saved).length;

  return (
    <Card className="border-primary/20 bg-card">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            <h3 className="font-display font-semibold text-foreground">Your First Captures</h3>
          </div>
          <Button variant="ghost" size="sm" onClick={handleComplete} className="text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-6">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
          >
            {/* Step 0 — Tools */}
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    What tools do you use daily?
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">Select all that apply</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TOOL_OPTIONS.map((tool) => (
                    <label
                      key={tool}
                      className={`flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                        tools.includes(tool)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      <Checkbox
                        checked={tools.includes(tool)}
                        onCheckedChange={() => toggleTool(tool)}
                      />
                      <span className="text-sm text-foreground">{tool}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Step 1 — Decisions */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                    What decisions do you make repeatedly?
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    E.g., "which framework to use", "how to prioritize features", "when to escalate issues"
                  </p>
                </div>
                <Textarea
                  value={decisions}
                  onChange={(e) => setDecisions(e.target.value)}
                  placeholder="One per line or comma-separated…"
                  rows={4}
                />
              </div>
            )}

            {/* Step 2 — Re-explaining */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Brain className="h-4 w-4 text-muted-foreground" />
                    What do you find yourself re-explaining to AI tools?
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    E.g., "my tech stack", "our team structure", "the project architecture"
                  </p>
                </div>
                <Textarea
                  value={reExplaining}
                  onChange={(e) => setReExplaining(e.target.value)}
                  placeholder="One per line or comma-separated…"
                  rows={4}
                />
              </div>
            )}

            {/* Step 3 — People */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Who are the key people in your work life right now?
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    E.g., "Sarah - Product Lead", "Tom - CTO", "Client: Acme Corp"
                  </p>
                </div>
                <Textarea
                  value={keyPeople}
                  onChange={(e) => setKeyPeople(e.target.value)}
                  placeholder="One per line or comma-separated…"
                  rows={4}
                />
              </div>
            )}

            {/* Step 4 — Suggestions */}
            {step === 4 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Your First 20 Captures
                    </h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Click "Save" to add each to your brain. {savedCount > 0 && `${savedCount} saved so far.`}
                    </p>
                  </div>
                </div>

                {generating ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Generating suggestions…
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                    {suggestions.map((s, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                          s.saved ? "border-primary/30 bg-primary/5" : "border-border"
                        }`}
                      >
                        <p className="flex-1 text-sm text-foreground">{s.text}</p>
                        <Button
                          size="sm"
                          variant={s.saved ? "outline" : "default"}
                          disabled={s.saving || s.saved}
                          onClick={() => saveSuggestion(i)}
                          className="shrink-0 h-7 text-xs"
                        >
                          {s.saving ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : s.saved ? (
                            <><Check className="h-3 w-3 mr-1" /> Saved</>
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center gap-3 mt-6">
          {step > 0 && (
            <Button variant="outline" size="sm" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step < totalSteps - 1 ? (
            <Button size="sm" onClick={goNext}>
              {step === 3 ? "Generate Suggestions" : "Next"} <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleComplete}>
              Done <Check className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function useShowFirstCaptures() {
  const [show, setShow] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem(ONBOARDING_KEY) === "true") return;

    // Check note count
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_trashed", false)
      .then(({ count }) => {
        if (count !== null && count < 5) {
          setShow(true);
        }
      });
  }, [user]);

  return { show, dismiss: () => setShow(false) };
}
