import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { BookOpen, FileText, Search } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type WikiPage = Database["public"]["Tables"]["wiki_pages"]["Row"];
type WikiRevision = Database["public"]["Tables"]["wiki_revisions"]["Row"];

const revisionBadgeVariant: Record<string, "success" | "info" | "secondary" | "destructive"> = {
  created: "success",
  updated: "info",
  manual_edit: "secondary",
  rolled_back: "destructive",
};

const labelize = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const relativeTime = (date: string) => `${formatDistanceToNow(new Date(date), { addSuffix: true })}`;

function WikiHomeSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2 rounded-md border border-border p-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WikiHome() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data: pages = [], isLoading: pagesLoading } = useQuery<WikiPage[]>({
    queryKey: ["wiki-pages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_pages")
        .select("id, user_id, slug, title, summary, content, page_type, source_count, metadata, last_synthesized_at, created_at, updated_at")
        .order("page_type", { ascending: true })
        .order("title", { ascending: true });
      if (error) throw error;
      return (data || []) as WikiPage[];
    },
  });

  const { data: revisions = [], isLoading: revisionsLoading } = useQuery<WikiRevision[]>({
    queryKey: ["wiki-revisions", "recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_revisions")
        .select("id, user_id, wiki_page_id, page_title, page_slug, change_type, change_summary, previous_content, new_content, source_note_id, source_revision_id, status, reviewed_at, rolled_back_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  const groupedPages = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = pages.filter((page) => {
      if (!query) return true;
      return page.title.toLowerCase().includes(query) || page.slug.toLowerCase().includes(query);
    });

    return filtered.reduce<Record<string, WikiPage[]>>((groups, page) => {
      const key = page.page_type || "other";
      groups[key] = [...(groups[key] || []), page].sort((a, b) => a.title.localeCompare(b.title));
      return groups;
    }, {});
  }, [pages, search]);

  const groupEntries = Object.entries(groupedPages).sort(([a], [b]) => a.localeCompare(b));
  const isLoading = pagesLoading || revisionsLoading;
  const hasNoPages = !pagesLoading && pages.length === 0;

  return (
    <div className="space-y-6">
      <SEOHead title="Lexicon — Menerio" noIndex />

      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Lexicon</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Your AI-generated knowledge lexicon, built automatically from your notes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              if (!confirm("Remove all dead [[wikilinks]] (links pointing to non-existent pages) from every Lexicon page?")) return;
              try {
                const { data, error } = await supabase.functions.invoke("wiki-cleanup", { body: { mode: "strip_dead_links" } });
                if (error) throw error;
                toast.success(`Stripped ${data?.links_removed ?? 0} dead links across ${data?.pages_changed ?? 0} pages`);
                navigate(0);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Strip failed");
              }
            }}
          >
            Strip dead links
          </Button>
          <Button variant="outline" onClick={openCleanup}>
            <Trash2 className="h-4 w-4" /> Cleanup
          </Button>
          <Button variant="secondary" onClick={() => navigate("/lexicon/lint")}>Run lint</Button>
        </div>
      </div>

      <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Lexicon cleanup</DialogTitle>
            <DialogDescription>
              These pages look like noise: no source notes, no incoming links, or near-empty content. Deselect any you want to keep, then delete the rest.
            </DialogDescription>
          </DialogHeader>
          {cleanupLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…
            </div>
          ) : cleanupCandidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing to clean up. Your Lexicon looks healthy.</p>
          ) : (
            <ScrollArea className="max-h-[50vh] pr-3">
              <div className="space-y-2">
                {cleanupCandidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-accent/40"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={cleanupSelection.has(candidate.id)}
                      onChange={() => toggleCandidate(candidate.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{candidate.title}</span>
                        <Badge variant="outline" className="text-xs">{candidate.page_type}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {candidate.reason.replace(/_/g, " ")} · {candidate.source_count} sources · {candidate.inbound_links} backlinks
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCleanupOpen(false)} disabled={cleanupDeleting}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={runCleanup}
              disabled={cleanupDeleting || cleanupSelection.size === 0}
            >
              {cleanupDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete {cleanupSelection.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search pages by title or slug"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <WikiHomeSkeleton />
      ) : hasNoPages ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <BookOpen className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="mb-2 text-lg">Your Lexicon is empty.</CardTitle>
            <CardDescription className="max-w-md">
              The Lexicon grows automatically as you write notes. Write or open a note, and it will start building itself in the background.
            </CardDescription>
            <Button className="mt-6" onClick={() => navigate("/dashboard/notes?action=create")}>
              <FileText className="h-4 w-4" />
              Create a note
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-8">
            {groupEntries.length === 0 ? (
              <div className="border-y border-border py-12 text-center text-sm text-muted-foreground">
                  No Lexicon pages match your search.
              </div>
            ) : (
              groupEntries.map(([pageType, groupPages]) => (
                <section key={pageType} className="border-t border-border pt-5 first:border-t-0 first:pt-0">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold">{labelize(pageType)}</h2>
                    <Badge variant="secondary">{groupPages.length}</Badge>
                  </div>
                  <div className="divide-y divide-border">
                    {groupPages.map((page) => (
                      <Link
                        key={page.id}
                        to={`/lexicon/${page.slug}`}
                        className="block py-4 transition-colors hover:bg-accent/40 sm:px-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-foreground">{page.title}</h3>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                              {page.summary || "No summary yet."}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0">{page.source_count} sources</Badge>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">Updated {relativeTime(page.updated_at)}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>

          <aside className="h-fit xl:sticky xl:top-20">
            <div className="border-l border-border pl-5">
              <h2 className="text-base font-semibold">Recent activity</h2>
              <div className="mt-4 space-y-4">
              {revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Lexicon activity yet.</p>
              ) : (
                revisions.map((revision) => (
                  <div key={revision.id} className="space-y-1.5 border-b border-border pb-4 last:border-0 last:pb-0">
                    <Badge variant={revisionBadgeVariant[revision.change_type] || "secondary"}>
                      {labelize(revision.change_type)}
                    </Badge>
                    <Link to={`/lexicon/${revision.page_slug}`} className="block text-sm font-medium text-foreground hover:underline">
                      {revision.page_title}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {revision.change_summary || "No summary provided."}
                    </p>
                    <p className="text-xs text-muted-foreground">{relativeTime(revision.created_at)}</p>
                  </div>
                ))
              )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}