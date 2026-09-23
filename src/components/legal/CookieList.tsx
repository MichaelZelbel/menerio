import { BRAND } from "@/lib/brand";
import { CONSENT_KEY } from "@/lib/consent";

// The exact cookies and browser storage this site uses, as measured on the production site
// in a fresh browser on 2026-09-22. Both the Cookie Policy and the Privacy Policy
// render this one list, so the two can never disagree. Update it when a measurement
// finds something new.
const ROWS: { name: string; set: string; lifetime: string; purpose: string; consent: string }[] = [
  {
    name: "__cf_bm",
    set: `Cloudflare, for our hosting (Lovable), on .${BRAND.domain}`,
    lifetime: "30 minutes",
    purpose: "Tells real visitors apart from automated traffic so the site stays reachable.",
    consent: "Strictly necessary, always set",
  },
  {
    name: "__dpl",
    set: `Our hosting (Lovable), on ${BRAND.domain}`,
    lifetime: "7 days",
    purpose: "Keeps you on the same published version of the site while you browse it.",
    consent: "Strictly necessary, always set",
  },
  {
    name: "sidebar:state",
    set: "This site, only in the signed-in app",
    lifetime: "7 days",
    purpose: "Remembers whether you collapsed the sidebar. Written only when you toggle it.",
    consent: "Strictly necessary for the setting you chose",
  },
  {
    name: "session-id",
    set: `Our hosting's visitor statistics (Lovable), on ${BRAND.domain}`,
    lifetime: "30 minutes",
    purpose: "Counts page views as one visit, so we know which pages people read. No ads, not shared for advertising.",
    consent: "Only after “Accept all”. “Just the essentials” deletes it at once.",
  },
];

export function CookieList() {
  return (
    <div className="not-prose space-y-4 mt-4">
      <ul className="space-y-4">
        {ROWS.map((r) => (
          <li key={r.name} className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            <p className="font-mono text-foreground">{r.name}</p>
            <p className="mt-1"><strong className="text-foreground">Set by:</strong> {r.set}</p>
            <p><strong className="text-foreground">Lifetime:</strong> {r.lifetime}</p>
            <p><strong className="text-foreground">Purpose:</strong> {r.purpose}</p>
            <p><strong className="text-foreground">Consent:</strong> {r.consent}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">
        Besides cookies, this site keeps two things in your browser's local storage: your cookie choice
        (<span className="font-mono">{CONSENT_KEY}</span>, kept until you change it, strictly necessary to remember
        it) and, once you sign in, your login session, so you stay signed in. Fonts are served from this site
        itself, so no font request goes to Google or any other third party.
      </p>
    </div>
  );
}
