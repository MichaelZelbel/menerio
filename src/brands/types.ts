// Brand configuration for white-label builds. See docs/BRANDING.md.
//
// IMPORTANT: files in src/brands/ must stay PURE DATA — no import.meta.env,
// no asset imports, no browser APIs — because vite.config.ts imports them
// under Node to brand the PWA manifest and index.html at build time.

export interface BrandConfig {
  id: "menerio" | "cherishly";
  /** Display name used in all user-facing copy. */
  name: string;
  /** Primary production domain (no protocol). */
  domain: string;
  /** Canonical origin, e.g. "https://menerio.com". */
  url: string;
  /** Short marketing tagline (footer blurb, hero subline). */
  tagline: string;
  /** Default meta description for index.html and SEOHead. */
  metaDescription: string;
  /** <title> of the built index.html. */
  htmlTitle: string;
  /** Appended to page titles by SEOHead, e.g. " — Menerio". */
  titleSuffix: string;
  supportEmail: string;
  /** Absolute URL of the default Open Graph image. */
  ogImage: string;
  /** Name of the per-person AI assistant persona. */
  personaName: string;
  /** CSS class applied to <html> that activates this brand's theme tokens; null = base theme. */
  themeClass: string | null;
  /** next-themes default when the user has never picked a theme. */
  defaultTheme: "dark" | "light";
  /** <meta name="theme-color"> for the built index.html. */
  htmlThemeColor: string;
  pwa: {
    name: string;
    shortName: string;
    description: string;
    themeColor: string;
    backgroundColor: string;
  };
  /** Sidebar nav group ordering; keys match the group map in DashboardSidebar. */
  navGroupOrder: Array<"notes" | "people" | "collections" | "review">;
  dashboardVariant: "notes-first" | "people-first";
  /** Subline under the dashboard welcome heading. */
  dashboardSubline: string;
  /** Marketing header nav links. */
  marketingNav: Array<{ label: string; to: string }>;
  /** Whether the sidebar shows the Documentation link (docs prose is Menerio-branded). */
  showDocs: boolean;
  /** Hosts whose links the rich-text editor treats as internal (SPA navigation). */
  internalHosts: string[];
  legal: { websiteUrl: string };
}
