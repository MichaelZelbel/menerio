import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Cookie } from "lucide-react";
import { BRAND } from "@/lib/brand";

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

  // Cherishly keeps its original playful banner (ported 1:1 from the old
  // app); the consent choices map onto the same storage semantics.
  if (BRAND.id === "cherishly") {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-fade-in">
        <div className="max-w-3xl mx-auto px-4 pb-4">
          <div
            className="bg-background/70 backdrop-blur-xl rounded-lg shadow-sm border border-border/20 px-4 py-2.5"
            style={{ backdropFilter: "blur(10px)" }}
          >
            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
              <p className="text-xs sm:text-sm text-foreground/90 text-center sm:text-left flex-1">
                A few cookies, so faces smile and feelings grow just right. 💗
              </p>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => handleChoice("essential")} className="h-8 px-3 text-xs">
                  Decline
                </Button>
                <Button size="sm" onClick={() => handleChoice("all")} className="h-8 px-3 text-xs">
                  Accept
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
