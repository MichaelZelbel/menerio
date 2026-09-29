import { useState, useEffect, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  BookOpen,
  Mail,
} from "lucide-react";
import { allDocs, docCategories, getDoc, getAdjacentDocs } from "@/content/docs/registry";
import { BRAND } from "@/lib/brand";

export default function Docs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSlug = searchParams.get("page") || "quick-start";
  const doc = getDoc(currentSlug);
  const { prev, next } = getAdjacentDocs(currentSlug);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // ?q= starts a search: the 404 page sends its search box here with it,
  // and this page used to ignore it.
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("q") ?? "");
  const [activeHeading, setActiveHeading] = useState("");

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allDocs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.searchText.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Active heading observer
  useEffect(() => {
    if (!doc) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActiveHeading(visible.target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );
    doc.headings.forEach((h) => {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [doc]);

  // Close the menu and go to the top on page change
  useEffect(() => {
    setMobileNavOpen(false);
    window.scrollTo(0, 0);
  }, [currentSlug]);

  const navigateTo = (slug: string) => {
    setSearchParams({ page: slug });
    setSearchQuery("");
    // Also when the page tapped is the one already open (no slug change).
    setMobileNavOpen(false);
  };

  if (!doc) {
    return (
      <div className="container py-24 text-center">
        <h1 className="text-2xl font-bold font-display">Page Not Found</h1>
        <p className="mt-2 text-muted-foreground">This documentation page doesn't exist.</p>
        <Button className="mt-6" onClick={() => navigateTo("quick-start")}>Go to Quick Start</Button>
      </div>
    );
  }

  return (
    <div className="container py-8 lg:py-12">
      <SEOHead
        title="Documentation — Menerio"
        description="Learn how to use Menerio with step-by-step guides, an API reference, integration tutorials, and best practices for building your knowledge system."
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: "Menerio Documentation",
          description: "Guides, API reference, and tutorials for Menerio — an AI-powered knowledge system.",
          inLanguage: "en",
          publisher: {
            "@type": "Organization",
            name: "Menerio",
            url: "https://menerio.com",
          },
          mainEntityOfPage: "https://menerio.com/docs",
        }}
      />
      {/* Search bar */}
      <div className="mb-6 flex items-center gap-3">
        <Button aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input aria-label="Search documentation"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documentation..."
            className="pl-9"
          />
          {searchResults.length > 0 && searchQuery && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border bg-popover p-1 shadow-lg">
              {searchResults.slice(0, 8).map((r) => (
                <button
                  key={r.slug}
                  onClick={() => navigateTo(r.slug)}
                  className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  <BookOpen className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">{r.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{r.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchResults.length === 0 && searchQuery.trim() && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
              No documentation page matches “{searchQuery.trim()}”.
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-8">
        {/* Left sidebar */}
        <aside
          className={cn(
            "shrink-0 w-56",
            mobileNavOpen
              ? "fixed inset-0 z-40 bg-background p-6 pt-20 overflow-auto lg:static lg:p-0 lg:pt-0"
              : "hidden lg:block"
          )}
        >
          {/* On a phone the open menu covers the whole screen, including the
              toggle above it, so it carries its own way out. */}
          {mobileNavOpen && (
            <div className="mb-4 flex justify-end lg:hidden">
              <Button
                aria-label="Close navigation"
                variant="ghost"
                size="icon"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          )}
          <nav className="sticky top-24 space-y-6">
            {docCategories.map((cat) => (
              <div key={cat.slug}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {cat.name}
                </p>
                <ul className="space-y-0.5">
                  {cat.pages.map((page) => (
                    <li key={page.slug}>
                      <button
                        onClick={() => navigateTo(page.slug)}
                        className={cn(
                          "block w-full text-left text-sm py-1.5 px-3 rounded-md transition-colors",
                          currentSlug === page.slug
                            ? "text-foreground bg-accent font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        )}
                      >
                        {page.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <article className="min-w-0 flex-1">
          <div className="mb-8">
            <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">{doc.category}</p>
            <h1 className="text-3xl font-bold font-display">{doc.title}</h1>
            <p className="mt-2 text-muted-foreground">{doc.description}</p>
          </div>

          <div className="prose prose-sm max-w-none dark:prose-invert [&_h2]:text-xl [&_h2]:font-display [&_h2]:font-bold [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:scroll-mt-24 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_li]:text-muted-foreground [&_ul]:space-y-1 [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:text-foreground">
            {doc.content()}
          </div>

          {/* Feedback. The old "Was this page helpful?" buttons thanked the
              reader for feedback that was never stored anywhere. */}
          <div className="mt-12 flex items-center gap-3 rounded-lg border p-4">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Something missing or unclear on this page? Write to{" "}
              <a
                href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`Documentation: ${doc.title}`)}`}
                className="text-primary hover:underline"
              >
                {BRAND.supportEmail}
              </a>
              .
            </p>
          </div>

          {/* Prev / Next */}
          <div className="mt-8 flex items-center justify-between gap-4">
            {prev ? (
              <Button variant="outline" onClick={() => navigateTo(prev.slug)} className="gap-2">
                <ChevronLeft className="h-4 w-4" /> {prev.title}
              </Button>
            ) : <div />}
            {next ? (
              <Button variant="outline" onClick={() => navigateTo(next.slug)} className="gap-2">
                {next.title} <ChevronRight className="h-4 w-4" />
              </Button>
            ) : <div />}
          </div>
        </article>

        {/* Right sidebar — TOC */}
        <aside className="hidden xl:block w-48 shrink-0">
          <nav className="sticky top-24">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">On this page</p>
            <ul className="space-y-1">
              {doc.headings.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className={cn(
                      "block text-sm py-1 px-2 rounded transition-colors",
                      activeHeading === h.id
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {h.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </div>
  );
}
