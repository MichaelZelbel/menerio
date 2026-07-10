import type { BrandConfig } from "./types";

// Cherishly — the people-first skin. Same app, same backend, same accounts;
// served from its own domain with a warm rose/purple look.
export const CHERISHLY: BrandConfig = {
  id: "cherishly",
  name: "Cherishly",
  domain: "cherishly.app",
  url: "https://cherishly.app",
  tagline: "Your little memory companion.",
  metaDescription:
    "Cherishly helps you remember what matters about the people you love — favorites, love languages, important dates, and the little moments in between.",
  htmlTitle: "Cherishly — Your little memory companion",
  titleSuffix: " — Cherishly",
  supportEmail: "support@cherishly.app",
  ogImage: "https://cherishly.app/og-image.png",
  personaName: "Claire",
  themeClass: "brand-cherishly",
  defaultTheme: "light",
  htmlThemeColor: "#fcf9f8",
  pwa: {
    name: "Cherishly — Your little memory companion",
    shortName: "Cherishly",
    description:
      "Remember what matters about the people you love — favorites, love languages, important dates, and little moments.",
    themeColor: "#e23670",
    backgroundColor: "#fcf9f8",
  },
  navGroupOrder: ["people", "notes", "collections", "review"],
  dashboardVariant: "people-first",
  dashboardSubline: "The people you cherish, at a glance.",
  marketingNav: [{ label: "Home", to: "/" }],
  showDocs: false,
  internalHosts: [
    "menerio.com",
    "www.menerio.com",
    "menerio.lovable.app",
    "cherishly.app",
    "www.cherishly.app",
  ],
  legal: { websiteUrl: "https://cherishly.app" },
};
