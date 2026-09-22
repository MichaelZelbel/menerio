import { openConsentSettings } from "@/lib/consent";

// Reopens the cookie banner, so changing or withdrawing consent is as easy as giving it.
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openConsentSettings} className={className}>
      Cookie settings
    </button>
  );
}
