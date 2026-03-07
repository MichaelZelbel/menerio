import { useEffect } from "react";

interface SEOHeadProps {
  title: string;
  description?: string;
  canonicalUrl?: string;
  ogImage?: string;
  ogType?: string;
  noIndex?: boolean;
  jsonLd?: Record<string, unknown>;
}

/**
 * Dynamically sets document title, meta tags, canonical URL,
 * Open Graph / Twitter Card tags, and optional JSON-LD per route.
 *
 * IMPORTANT: canonical defaults to origin + pathname (no query params)
 * so every page self-declares as canonical. Never hardcode canonical in index.html.
 */
export function SEOHead({
  title,
  description,
  canonicalUrl,
  ogImage = "/og-image.png",
  ogType = "website",
  noIndex = false,
  jsonLd,
}: SEOHeadProps) {
  useEffect(() => {
    // Title
    document.title = title;

    // Canonical
    const canonical = canonicalUrl ?? window.location.origin + window.location.pathname;
    setMeta("link[rel='canonical']", canonical, "link");

    // Meta description
    if (description) setMeta("meta[name='description']", description);

    // Robots
    setMeta("meta[name='robots']", noIndex ? "noindex, nofollow" : "index, follow");

    // Open Graph
    setMeta("meta[property='og:title']", title);
    if (description) setMeta("meta[property='og:description']", description);
    setMeta("meta[property='og:type']", ogType);
    setMeta("meta[property='og:url']", canonical);
    setMeta("meta[property='og:image']", ogImage);

    // Twitter Card
    setMeta("meta[name='twitter:title']", title);
    if (description) setMeta("meta[name='twitter:description']", description);
    setMeta("meta[name='twitter:image']", ogImage);

    // JSON-LD
    const ldId = "seo-json-ld";
    let ldScript = document.getElementById(ldId) as HTMLScriptElement | null;
    if (jsonLd) {
      if (!ldScript) {
        ldScript = document.createElement("script");
        ldScript.id = ldId;
        ldScript.type = "application/ld+json";
        document.head.appendChild(ldScript);
      }
      ldScript.textContent = JSON.stringify(jsonLd);
    } else if (ldScript) {
      ldScript.remove();
    }

    return () => {
      // Cleanup JSON-LD on unmount
      document.getElementById(ldId)?.remove();
    };
  }, [title, description, canonicalUrl, ogImage, ogType, noIndex, jsonLd]);

  return null;
}

/** Helper to upsert a meta tag or link element. */
function setMeta(selector: string, value: string, tagType: "meta" | "link" = "meta") {
  let el = document.head.querySelector(selector);

  if (tagType === "link") {
    if (!el) {
      el = document.createElement("link");
      (el as HTMLLinkElement).rel = "canonical";
      document.head.appendChild(el);
    }
    (el as HTMLLinkElement).href = value;
    return;
  }

  if (!el) {
    el = document.createElement("meta");
    // Determine attribute type from selector
    const propMatch = selector.match(/\[property='(.+?)'\]/);
    const nameMatch = selector.match(/\[name='(.+?)'\]/);
    if (propMatch) el.setAttribute("property", propMatch[1]);
    else if (nameMatch) el.setAttribute("name", nameMatch[1]);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
}
