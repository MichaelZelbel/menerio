import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowLeft, ExternalLink, FileText, History, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { diffChangedSectionSlugs } from "@/lib/wiki-sections";

type WikiPageRow = Database["public"]["Tables"]["wiki_pages"]["Row"];
type WikiRevisionRow = Database["public"]["Tables"]["wiki_revisions"]["Row"];
type WikiSource = { id: string; note_id: string; created_at: string; notes: { id: string; title: string; content: string; created_at: string } | null };
type Backlink = { id: string; source_page_id: string; source: Pick<WikiPageRow, "id" | "slug" | "title" | "summary"> | null };
type RevisionWithSource = WikiRevisionRow & { notes?: { title: string } | null };

const revisionBadgeVariant: Record<string, "success" | "info" | "secondary" | "destructive"> = {
  created: "success",
  updated: "info",
  manual_edit: "secondary",
  rolled_back: "destructive",
};

const labelize = (value: string) => value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const relativeTime = (date: string) => formatDistanceToNow(new Date(date), { addSuffix: true });
const truncate = (value: string, length = 240) => (value.length > length ? `${value.slice(0, length).trim()}…` : value);
const slugifyHeading = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-") || "section";

type WikiHeading = { id: string; title: string; level: number };

function extractHeadings(markdown: string): WikiHeading[] {
  const seen = new Map<string, number>();
  return markdown.split("\n").flatMap((line) => {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (!match) return [];
    const title = match[2].replace(/[*_`[\]()]/g, "").trim();
    const baseId = slugifyHeading(title);
    const count = seen.get(baseId) || 0;
    seen.set(baseId, count + 1);
    return [{ id: count ? `${baseId}-${count + 1}` : baseId, title, level: match[1].length }];
  });
}

function normalizeWikiContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const hasMarkdownStructure = /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)|\n\s*\n/.test(trimmed);
  if (hasMarkdownStructure || trimmed.length < 420) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [trimmed];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    paragraphs.push(sentences.slice(i, i + 3).join(" "));
  }
  return paragraphs.join("\n\n");
}

function WikiPageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-5 w-96" />
      <Card><CardContent className="space-y-3 p-6"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-2/3" /></CardContent></Card>
      <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
    </div>
  );
}

export default function WikiPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const latestMarkdownRef = useRef("");
  const [editMode, setEditMode] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState<RevisionWithSource | null>(null);
  const [activeHeading, setActiveHeading] = useState("");

  const { data: page, isLoading: pageLoading } = useQuery<WikiPageRow | null>({
    queryKey: ["wiki-page", slug],
    queryFn: async () => {
      const { data, error } = await supabase.from("wiki_pages").select("*").eq("slug", slug).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!page) return;
    setTitleDraft(page.title);
    latestMarkdownRef.current = page.content;
  }, [page]);

  const { data: revisions = [], isLoading: revisionsLoading } = useQuery<RevisionWithSource[]>({
    queryKey: ["wiki-revisions", slug, page?.id],
    enabled: !!page,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_revisions" as any)
        .select("*, notes:source_note_id(title)")
        .eq("wiki_page_id", page!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data || []) as unknown) as RevisionWithSource[];
    },
  });

  const { data: backlinks = [], isLoading: backlinksLoading } = useQuery<Backlink[]>({
    queryKey: ["wiki-backlinks", slug, page?.id],
    enabled: !!page,
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("wiki_links")
        .select("id, source_page_id")
        .or(`target_slug.eq.${slug},target_page_id.eq.${page!.id}`);
      if (error) throw error;
      const sourceIds = [...new Set((links || []).map((link) => link.source_page_id))];
      if (sourceIds.length === 0) return [];
      const { data: sourcePages, error: sourceError } = await supabase
        .from("wiki_pages")
        .select("id, slug, title, summary")
        .in("id", sourceIds);
      if (sourceError) throw sourceError;
      const sourceMap = new Map((sourcePages || []).map((source) => [source.id, source]));
      return (links || []).map((link) => ({ ...link, source: sourceMap.get(link.source_page_id) || null }));
    },
  });

  const { data: sources = [], isLoading: sourcesLoading } = useQuery<WikiSource[]>({
    queryKey: ["wiki-sources", page?.id],
    enabled: !!page,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_page_sources" as any)
        .select("id, note_id, created_at, notes:note_id(id, title, content, created_at)")
        .eq("wiki_page_id", page!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data || []) as unknown) as WikiSource[];
    },
  });

  const { data: wikiPages = [] } = useQuery<Pick<WikiPageRow, "id" | "slug" | "title" | "page_type">[]>({
    queryKey: ["wiki-pages", "sidebar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_pages")
        .select("id, slug, title, page_type")
        .order("page_type", { ascending: true })
        .order("title", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const refreshWikiLinkStubs = useCallback(async () => {
    const root = editorWrapRef.current;
    if (!root) return;
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>(".wiki-link[data-slug]"));
    const slugs = [...new Set(links.map((link) => link.dataset.slug).filter(Boolean) as string[])];
    if (slugs.length === 0) return;
    const { data, error } = await supabase.from("wiki_pages").select("slug").in("slug", slugs);
    if (error) return;
    const existing = new Set((data || []).map((row) => row.slug));
    links.forEach((link) => {
      const exists = existing.has(link.dataset.slug || "");
      link.classList.toggle("wiki-link-stub", !exists);
      link.title = exists ? link.dataset.slug || "" : "This page does not exist yet.";
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(refreshWikiLinkStubs, 50);
    return () => window.clearTimeout(timer);
  }, [page?.content, editMode, refreshWikiLinkStubs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!page || !user) throw new Error("Not authenticated");
      const newContent = latestMarkdownRef.current;
      const newTitle = titleDraft.trim() || page.title;
      const changedSlugs = diffChangedSectionSlugs(page.content || "", newContent);
      const previousProtected = (page as unknown as { protected_sections?: string[] }).protected_sections || [];
      const nextProtected = Array.from(new Set([...previousProtected, ...changedSlugs]));

      const { error: revisionError } = await supabase.from("wiki_revisions").insert({
        user_id: user.id,
        wiki_page_id: page.id,
        page_slug: page.slug,
        page_title: newTitle,
        change_type: "manual_edit",
        previous_content: page.content,
        new_content: newContent,
        change_summary: "Manual edit",
        source_note_id: null,
        status: "applied",
      });
      if (revisionError) throw revisionError;
      const { error: updateError } = await supabase
        .from("wiki_pages")
        .update({ title: newTitle, content: newContent, protected_sections: nextProtected } as never)
        .eq("id", page.id);
      if (updateError) throw updateError;
      const { error: rpcError } = await supabase.rpc("wiki_resync_links", { p_page_id: page.id });
      if (rpcError) throw rpcError;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wiki-page", slug] }),
        queryClient.invalidateQueries({ queryKey: ["wiki-revisions"] }),
        queryClient.invalidateQueries({ queryKey: ["wiki-backlinks"] }),
      ]);
      toast.success("Saved");
      setEditMode(false);
    },
    onError: () => toast.error("Could not save Lexicon page"),
  });

  const pageMeta = useMemo(() => page ? `Updated ${relativeTime(page.updated_at)} · ${page.source_count} sources` : "", [page]);
  const displayContent = useMemo(() => page ? normalizeWikiContent(page.content) : "", [page]);
  const headings = useMemo(() => extractHeadings(displayContent), [displayContent]);
  const groupedWikiPages = useMemo(() => wikiPages.reduce<Record<string, typeof wikiPages>>((groups, wikiPage) => {
    const key = wikiPage.page_type || "other";
    groups[key] = [...(groups[key] || []), wikiPage];
    return groups;
  }, {}), [wikiPages]);
  const groupSlug = page?.page_type === "group" && page.slug.startsWith("group-") ? page.slug.replace(/^group-/, "") : null;

  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveHeading(visible.target.id);
      },
      { rootMargin: "-96px 0px -65% 0px", threshold: 0.1 }
    );
    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [headings, displayContent]);

  useEffect(() => {
    if (!editorWrapRef.current || editMode || headings.length === 0) return;
    const headingElements = Array.from(editorWrapRef.current.querySelectorAll("h1, h2, h3"));
    headingElements.forEach((element, index) => {
      const heading = headings[index];
      if (heading) element.id = heading.id;
    });
    setActiveHeading((current) => current || headings[0]?.id || "");
  }, [displayContent, editMode, headings]);

  if (pageLoading) return <WikiPageSkeleton />;

  if (!page) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <SEOHead title="Lexicon page not found — Menerio" noIndex />
        <Card className="max-w-lg border-dashed text-center">
          <CardContent className="py-12">
            <CardTitle className="mb-2">This page doesn't exist yet.</CardTitle>
            <CardDescription>The Lexicon creates pages automatically as you write notes — keep writing, and pages will appear here.</CardDescription>
            <Button className="mt-6" onClick={() => navigate("/lexicon")}><ArrowLeft className="h-4 w-4" /> Back to Lexicon</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SEOHead title={`${page.title} — Lexicon — Menerio`} noIndex />
      <div className="flex flex-col gap-3 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link to="/lexicon" className="hover:text-foreground">Lexicon</Link><span>/</span><span>{labelize(page.page_type)}</span><span>/</span><span className="text-foreground">{page.title}</span>
          </div>
          <div>
            <h1 className="max-w-4xl text-3xl font-display font-bold leading-tight sm:text-4xl">{page.title}</h1>
            {page.summary && <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">{page.summary}</p>}
          </div>
          <p className="text-sm text-muted-foreground">{pageMeta}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {editMode ? (
            <>
              <Button variant="outline" onClick={() => { setEditMode(false); setTitleDraft(page.title); latestMarkdownRef.current = page.content; }}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="h-4 w-4" /> Save</Button>
            </>
          ) : (
            <>
              {groupSlug && <Button asChild variant="outline"><Link to={`/dashboard/groups/${groupSlug}`}><Users className="h-4 w-4" /> View as Group</Link></Button>}
              <Button variant="outline" onClick={() => setEditMode(true)}>Edit</Button>
              <Button variant="secondary" onClick={() => setRevisionsOpen(true)}><History className="h-4 w-4" /> View revisions</Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[240px_minmax(0,1fr)_220px]">
        <aside className="hidden xl:block">
          <nav className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto border-r border-border pr-4">
            <Link to="/lexicon" className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary">
              <FileText className="h-4 w-4" /> Lexicon index
            </Link>
            <div className="space-y-5">
              {Object.entries(groupedWikiPages).map(([pageType, items]) => (
                <div key={pageType}>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{labelize(pageType)}</p>
                  <div className="space-y-1">
                    {items.map((item) => (
                      <Link
                        key={item.id}
                        to={`/lexicon/${item.slug}`}
                        className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${item.slug === page.slug ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                      >
                        {item.title}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        </aside>

        <main className="min-w-0">
          {editMode && <Input className="mb-4" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />}
          <div ref={editorWrapRef}>
            <RichTextEditor
              value={editMode ? latestMarkdownRef.current || page.content : displayContent}
              editable={editMode}
              showToolbar={editMode}
              className={editMode ? undefined : "wiki-article-editor border-0 bg-transparent"}
              onChange={(markdown) => { latestMarkdownRef.current = markdown; void refreshWikiLinkStubs(); }}
              onWikiLinkClick={(targetSlug, element) => { if (!element.classList.contains("wiki-link-stub")) navigate(`/lexicon/${encodeURIComponent(targetSlug)}`); }}
            />
          </div>

          <div className="mt-12 border-t border-border pt-8">
            <div className="grid gap-8 lg:grid-cols-2">
              <section>
                <h2 className="text-base font-semibold">Backlinks</h2>
                <div className="mt-3 space-y-2">
                  {backlinksLoading ? <Skeleton className="h-16" /> : backlinks.length === 0 ? <p className="text-sm text-muted-foreground">No pages link here yet.</p> : backlinks.map((backlink) => backlink.source && (
                    <Link key={backlink.id} to={`/lexicon/${backlink.source.slug}`} className="block rounded-md border border-border p-3 transition-colors hover:bg-accent">
                      <p className="text-sm font-medium">{backlink.source.title}</p>
                      {backlink.source.summary && <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{backlink.source.summary}</p>}
                    </Link>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="text-base font-semibold">Sources</h2>
                <div className="mt-3 space-y-2">
                  {sourcesLoading ? <Skeleton className="h-20" /> : sources.length === 0 ? <p className="text-sm text-muted-foreground">No sources cited yet.</p> : sources.map((source) => source.notes && (
                    <div key={source.id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{source.notes.title || "Untitled"}</p><p className="mt-1 text-xs text-muted-foreground">{format(new Date(source.notes.created_at), "MMM d, yyyy")}</p></div>
                        <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/notes/${source.notes!.id}`)}><ExternalLink className="h-3.5 w-3.5" /> Open note</Button>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{truncate(source.notes.content || "")}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </main>

        <aside className="hidden xl:block">
          <nav className="sticky top-20 border-l border-border pl-5">
            <p className="mb-3 text-sm font-semibold text-foreground">On this page</p>
            {headings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sections yet.</p>
            ) : (
              <div className="space-y-1">
                {headings.map((heading) => (
                  <a
                    key={heading.id}
                    href={`#${heading.id}`}
                    className={`block rounded px-2 py-1 text-sm transition-colors ${activeHeading === heading.id ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"} ${heading.level === 3 ? "ml-3" : heading.level === 2 ? "ml-1" : ""}`}
                  >
                    {heading.title}
                  </a>
                ))}
              </div>
            )}
          </nav>
        </aside>
      </div>

      <Sheet open={revisionsOpen} onOpenChange={setRevisionsOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>Revisions</SheetTitle><SheetDescription>{page.title}</SheetDescription></SheetHeader>
          <div className="mt-6 space-y-3">
            {revisionsLoading ? <Skeleton className="h-24" /> : revisions.map((revision) => (
              <button key={revision.id} onClick={() => setSelectedRevision(revision)} className="w-full rounded-md border border-border p-3 text-left hover:bg-accent">
                <div className="mb-2 flex items-center justify-between gap-2"><Badge variant={revisionBadgeVariant[revision.change_type] || "secondary"}>{labelize(revision.change_type)}</Badge><span className="text-xs text-muted-foreground">{relativeTime(revision.created_at)}</span></div>
                <p className="text-sm font-medium">{revision.change_summary || "No summary"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{revision.source_note_id ? revision.notes?.title || "Source note" : "Manual edit"} · {revision.status}</p>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!selectedRevision} onOpenChange={(open) => !open && setSelectedRevision(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>Revision diff</DialogTitle></DialogHeader>
          {selectedRevision && <div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-sm font-medium">Previous</p><pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{selectedRevision.previous_content || ""}</pre></div><div><p className="mb-2 text-sm font-medium">New</p><pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{selectedRevision.new_content}</pre></div></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}