import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Section {
  id: string;
  title: string;
}

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  sections: Section[];
  children: React.ReactNode;
}

export function LegalLayout({ title, lastUpdated, sections, children }: LegalLayoutProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id || "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <div className="container py-12 lg:py-16">
      <div className="mb-10">
        <h1 className="text-3xl font-bold font-display sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
      </div>
      <div className="flex gap-12">
        {/* Sidebar TOC — desktop only */}
        <aside className="hidden lg:block w-56 shrink-0">
          <nav className="sticky top-24 space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">On this page</p>
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={cn(
                  "block text-sm py-1.5 px-3 rounded-md transition-colors",
                  activeId === s.id
                    ? "text-foreground bg-accent font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {s.title}
              </a>
            ))}
          </nav>
        </aside>
        {/* Content */}
        <article className="min-w-0 flex-1 prose prose-sm max-w-none dark:prose-invert [&_h2]:text-xl [&_h2]:font-display [&_h2]:font-bold [&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:scroll-mt-24 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:text-muted-foreground [&_p]:leading-relaxed [&_li]:text-muted-foreground [&_ul]:space-y-1">
          {children}
        </article>
      </div>
    </div>
  );
}
