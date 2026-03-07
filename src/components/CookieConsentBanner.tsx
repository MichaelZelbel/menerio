import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Cookie } from "lucide-react";

const COOKIE_CONSENT_KEY = "menerio-cookie-consent";

type ConsentChoice = "all" | "essential" | null;

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!stored) setVisible(true);
  }, []);

  const handleChoice = (choice: ConsentChoice) => {
    if (choice) {
      localStorage.setItem(COOKIE_CONSENT_KEY, choice);
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-fade-in">
      <div className="container">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 sm:items-center">
            <Cookie className="h-5 w-5 shrink-0 text-primary mt-0.5 sm:mt-0" />
            <p className="text-sm text-muted-foreground">
              We use cookies to improve your experience. By continuing, you agree to our{" "}
              <a href="/cookies" className="text-primary hover:underline">Cookie Policy</a>.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleChoice("essential")}>
              Reject Non-Essential
            </Button>
            <Button size="sm" onClick={() => handleChoice("all")}>
              Accept All
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
