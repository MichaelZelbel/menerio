import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Cookie } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { CONSENT_EVENT, CONSENT_KEY, readConsent, saveConsent, type Consent } from "@/lib/consent";

// Two equal choices on the first screen, and nothing optional runs before one is
// made: the gate in <head> (src/lib/consent.ts) holds the host's statistics until
// "Accept all". "Cookie settings" in the footer reopens this banner.
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!readConsent()) setVisible(true);
    const reopen = () => setVisible(true);
    // a choice made in another tab of this site closes the banner here too
    const synced = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY) setVisible(!readConsent());
    };
    window.addEventListener(CONSENT_EVENT, reopen);
    window.addEventListener("storage", synced);
    return () => {
      window.removeEventListener(CONSENT_EVENT, reopen);
      window.removeEventListener("storage", synced);
    };
  }, []);

  const choose = (choice: Consent) => {
    saveConsent(choice);
    setVisible(false);
  };

  if (!visible) return null;

  // Cherishly keeps its original playful banner (ported 1:1 from the old
  // app), with the same two equal choices.
  if (BRAND.id === "cherishly") {
    return (
      <div role="dialog" aria-live="polite" aria-label="Cookie choice" className="fixed bottom-0 left-0 right-0 z-50 animate-fade-in">
        <div className="max-w-3xl mx-auto px-4 pb-4">
          <div
            className="bg-background/70 backdrop-blur-xl rounded-lg shadow-sm border border-border/20 px-4 py-2.5"
            style={{ backdropFilter: "blur(10px)" }}
          >
            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
              <p className="text-xs sm:text-sm text-foreground/90 text-center sm:text-left flex-1">
                A few cookies keep this site running. With "Accept all" we also count your visit. 💗{" "}
                <a href="/cookies" className="underline">Details</a>
              </p>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" onClick={() => choose("essential")} className="h-8 px-3 text-xs">
                  Just the essentials
                </Button>
                <Button size="sm" onClick={() => choose("all")} className="h-8 px-3 text-xs">
                  Accept all
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-live="polite" aria-label="Cookie choice" className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-fade-in">
      <div className="container">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 sm:items-center">
            <Cookie className="h-5 w-5 shrink-0 text-primary mt-0.5 sm:mt-0" />
            <p className="text-sm text-muted-foreground">
              A few cookies keep this site working. With "Accept all" we also
              count your visit, so we know which pages people read. No ads, nothing sold. Details
              in our <a href="/cookies" className="text-primary hover:underline">Cookie Policy</a>.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => choose("essential")}>
              Just the essentials
            </Button>
            <Button size="sm" onClick={() => choose("all")}>
              Accept all
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
