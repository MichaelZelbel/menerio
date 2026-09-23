import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, X } from "lucide-react";
import { BRAND } from "@/lib/brand";

interface GettingStartedChecklistProps {
  hasProfile: boolean;
  hasNotes: boolean;
  /** At least one note carries AI metadata. */
  hasAiNote?: boolean;
}

const FEATURES_SEEN_KEY = "menerio-checklist-features-seen";

export function GettingStartedChecklist({ hasProfile, hasNotes, hasAiNote = false }: GettingStartedChecklistProps) {
  const navigate = useNavigate();
  const [showChecklist, setShowChecklist] = useState(() => {
    return localStorage.getItem("menerio-checklist-dismissed") !== "true";
  });

  const dismissChecklist = () => {
    localStorage.setItem("menerio-checklist-dismissed", "true");
    setShowChecklist(false);
  };

  const [featuresSeen, setFeaturesSeen] = useState(() => localStorage.getItem(FEATURES_SEEN_KEY) === "true");

  // Two items could never be ticked ("Process a note with AI" was hard-coded
  // false, "Explore features" had no signal), so the list sat at 2/4 forever.
  const checklistItems = [
    { label: "Complete your profile", done: hasProfile, action: () => navigate("/dashboard/settings") },
    { label: "Create your first note", done: hasNotes, action: () => navigate("/dashboard/notes?action=create") },
    { label: "Process a note with AI", done: hasAiNote, action: () => navigate("/dashboard/notes") },
    // The features page is part of a brand's marketing site only when its
    // header links to it; Cherishly's does not, and landed on the other brand's page.
    ...(BRAND.marketingNav.some((link) => link.to === "/features") ? [{
      label: "Explore features",
      done: featuresSeen,
      action: () => {
        localStorage.setItem(FEATURES_SEEN_KEY, "true");
        setFeaturesSeen(true);
        navigate("/features");
      },
    }] : []),
  ];
  const completedCount = checklistItems.filter((i) => i.done).length;

  if (!showChecklist) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <CardTitle className="text-base">Getting Started</CardTitle>
          <CardDescription className="text-xs mt-1">
            {completedCount}/{checklistItems.length} completed
          </CardDescription>
        </div>
        <Button aria-label="Dismiss checklist" variant="ghost" size="icon" className="h-6 w-6 -mr-1 -mt-1" onClick={dismissChecklist}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${(completedCount / checklistItems.length) * 100}%` }}
          />
        </div>
        <ul className="space-y-2">
          {checklistItems.map((item) => (
            <li key={item.label}>
              <button
                onClick={item.action}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent text-left"
              >
                {item.done ? (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                )}
                <span className={item.done ? "text-muted-foreground line-through" : "text-foreground"}>
                  {item.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
