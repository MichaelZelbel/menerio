import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, BookOpen, ChevronDown, ExternalLink, Loader2, Play, RotateCcw } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type WikiPage = Pick<Database["public"]["Tables"]["wiki_pages"]["Row"], "id" | "slug" | "title" | "page_type" | "updated_at">;
type WikiLog = Pick<Database["public"]["Tables"]["wiki_log"]["Row"], "id" | "created_at" | "details">;

type Severity = "high" | "medium" | "low" | string;

type LintFindings = {
  unresolved_wikilinks: Array<{ source_page_slug: string; source_page_title: string; target_slug: string }>;
  orphan_pages: Array<{ slug: string; title: string; page_type: string; updated_at: string }>;
  age_stale_pages: Array<{ slug: string; title: string; updated_at: string; days_since_update: number }>;
  contradictions: Array<{ pages: string[]; description: string; severity: Severity; suggested_fix: string }>;
  drift: Array<{ page: string; section: string; description: string; severity: Severity; suggested_fix: string }>;
  gaps: Array<{ page: string; missing_link: string; description: string; severity: Severity; suggested_fix: string }>;
  stale_syntheses: Array<{ page: string; description: string; severity: Severity; suggested_fix: string }>;
  llm_error: string | null;
};

type LintResponse = {
  ok: boolean;
  findings: LintFindings;
  counts?: Record<string, number>;
  duration_ms?: number;
};

const emptyFindings: LintFindings = {
  unresolved_wikilinks: [],
  orphan_pages: [],
  age_stale_pages: [],
  contradictions: [],
  drift: [],
  gaps: [],
  stale_syntheses: [],
  llm_error: null,
};

const relativeTime = (date: string) => formatDistanceToNow(new Date(date), { addSuffix: true });
const pagePath = (slug: string) => `/wiki/${slug}`;

function severityVariant(severity: Severity): "destructive" | "default" | "secondary" | "outline" {
  if (severity === "high") return "destructive";
  if (severity === "medium") return "default";
  if (severity === "low") return "secondary";
  return "outline";
}

function useWikiLintData() {
  const pagesQuery = useQuery<WikiPage[]>({
    queryKey: ["wiki-pages", "lint-index"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_pages")
        .select("id, slug, title, page_type, updated_at")
        .order("title", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const lastRunQuery = useQuery<WikiLog | null>({
    queryKey: ["wiki-log", "last-lint"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_log")
        .select("id, created_at, details")
        .eq("operation", "lint")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return { pagesQuery, lastRunQuery };
}

function LintSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(count > 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <button className="flex w-full items-center justify-between gap-3 p-6 text-left">
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="mt-1">{count > 0 ? `${count} issue${count === 1 ? "" : "s"} found` : "No issues found"}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={count > 0 ? "destructive" : "secondary"}>{count}</Badge>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">{count > 0 ? children : <p className="text-sm text-muted-foreground">No issues found.</p>}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function PageLink({ slug, title }: { slug: string; title?: string }) {
  return <Link to={pagePath(slug)} className="font-medium text-foreground hover:text-primary">{title || slug}</Link>;
}

export default function WikiLintPlaceholder() {
  const navigate = useNavigate();
  const { pagesQuery, lastRunQuery } = useWikiLintData();
  const [result, setResult] = useState<LintResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const pageTitles = useMemo(() => new Map((pagesQuery.data || []).map((page) => [page.slug, page.title])), [pagesQuery.data]);
  const findings = result?.findings || emptyFindings;
  const hasNoPages = !pagesQuery.isLoading && (pagesQuery.data || []).length === 0;

  const runLint = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("wiki-lint", { body: {} });
      if (invokeError) throw invokeError;
      setResult(data as LintResponse);
      await lastRunQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wiki lint failed");
    } finally {
      setIsRunning(false);
    }
  };

  const openPage = (slug: string) => navigate(pagePath(slug));

  return (
    <div className="space-y-6">
      <SEOHead title="Wiki health check — Menerio" noIndex />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Wiki health check</h1>
          <p className="mt-1 text-sm text-muted-foreground">Find orphans, broken links, drift, contradictions, gaps, and stale syntheses. Run when the wiki feels off.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Last lint: {lastRunQuery.isLoading ? "Loading…" : lastRunQuery.data ? relativeTime(lastRunQuery.data.created_at) : "Never run."}
          </p>
        </div>
        <Button onClick={runLint} disabled={isRunning || hasNoPages}>
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run lint
        </Button>
      </div>

      {pagesQuery.isLoading ? (
        <Card><CardContent className="space-y-3 py-8"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-full" /></CardContent></Card>
      ) : hasNoPages ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/50" />
            <CardTitle className="mb-2 text-lg">No pages to lint yet.</CardTitle>
            <CardDescription>The wiki health check will be available once wiki pages exist.</CardDescription>
          </CardContent>
        </Card>
      ) : (
        <>
          {isRunning && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertTitle>Auditing</AlertTitle>
              <AlertDescription>This can take 30–60 seconds while the AI checks for drift and contradictions.</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Wiki lint failed</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={runLint} disabled={isRunning}><RotateCcw className="h-4 w-4" /> Retry</Button>
              </AlertDescription>
            </Alert>
          )}

          {findings.llm_error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>AI audit failed</AlertTitle>
              <AlertDescription>Deterministic findings are still shown. AI error: {findings.llm_error}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Last run</CardTitle>
              <CardDescription>
                {result?.duration_ms ? `Completed in ${Math.round(result.duration_ms / 1000)} seconds.` : lastRunQuery.data ? `Last lint ran ${relativeTime(lastRunQuery.data.created_at)}.` : "Never run."}
              </CardDescription>
            </CardHeader>
          </Card>

          <LintSection title="Unresolved wikilinks" count={findings.unresolved_wikilinks.length}>
            {findings.unresolved_wikilinks.map((item, index) => (
              <div key={`${item.source_page_slug}-${item.target_slug}-${index}`} className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm"><PageLink slug={item.source_page_slug} title={item.source_page_title} /> <span className="text-muted-foreground">links to missing</span> <code className="rounded bg-muted px-1.5 py-0.5 text-xs">[[{item.target_slug}]]</code></div>
                <div className="flex gap-2"><Button size="sm" variant="outline" asChild><Link to={pagePath(item.source_page_slug)}>Open page</Link></Button><Button size="sm" variant="ghost">Ignore</Button></div>
              </div>
            ))}
          </LintSection>

          <LintSection title="Orphan pages" count={findings.orphan_pages.length}>
            {findings.orphan_pages.map((page) => (
              <div key={page.slug} className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm"><PageLink slug={page.slug} title={page.title} /> <Badge variant="outline" className="ml-2">{page.page_type}</Badge><p className="mt-1 text-xs text-muted-foreground">Updated {relativeTime(page.updated_at)}</p></div>
                <Button size="sm" variant="outline" asChild><Link to={pagePath(page.slug)}>Open</Link></Button>
              </div>
            ))}
          </LintSection>

          <LintSection title="Age-stale pages" count={findings.age_stale_pages.length}>
            {findings.age_stale_pages.map((page) => (
              <div key={page.slug} className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm"><PageLink slug={page.slug} title={page.title} /><p className="mt-1 text-xs text-muted-foreground">Last updated {format(new Date(page.updated_at), "MMM d, yyyy")} · {page.days_since_update} days ago</p></div>
                <Button size="sm" variant="outline" asChild><Link to={pagePath(page.slug)}>Open</Link></Button>
              </div>
            ))}
          </LintSection>

          <LintSection title="Contradictions" count={findings.contradictions.length}>
            {findings.contradictions.map((item, index) => (
              <div key={index} className="rounded-md border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>{item.pages.map((slug) => <PageLink key={slug} slug={slug} title={pageTitles.get(slug)} />)}</div>
                <p className="mt-3 text-muted-foreground">{item.description}</p><Separator className="my-3" /><p>{item.suggested_fix}</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => openPage(item.pages[0])}><ExternalLink className="h-4 w-4" /> Open page</Button>
              </div>
            ))}
          </LintSection>

          <LintSection title="Drift" count={findings.drift.length}>
            {findings.drift.map((item, index) => (
              <div key={index} className="rounded-md border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={severityVariant(item.severity)}>{item.severity}</Badge><PageLink slug={item.page} title={pageTitles.get(item.page)} /><span className="text-muted-foreground">{item.section}</span></div>
                <p className="mt-3 text-muted-foreground">{item.description}</p><Separator className="my-3" /><p>{item.suggested_fix}</p>
                <Button className="mt-3" size="sm" variant="outline" asChild><Link to={pagePath(item.page)}>Open page</Link></Button>
              </div>
            ))}
          </LintSection>

          <LintSection title="Gaps" count={findings.gaps.length}>
            {findings.gaps.map((item, index) => (
              <div key={index} className="rounded-md border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={severityVariant(item.severity)}>{item.severity}</Badge><PageLink slug={item.page} title={pageTitles.get(item.page)} /><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{item.missing_link}</code></div>
                <p className="mt-3 text-muted-foreground">{item.description}</p><Separator className="my-3" /><p>{item.suggested_fix}</p>
                <Button className="mt-3" size="sm" variant="outline" asChild><Link to={pagePath(item.page)}>Open page</Link></Button>
              </div>
            ))}
          </LintSection>

          <LintSection title="Stale syntheses" count={findings.stale_syntheses.length}>
            {findings.stale_syntheses.map((item, index) => (
              <div key={index} className="rounded-md border border-border p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2"><Badge variant={severityVariant(item.severity)}>{item.severity}</Badge><PageLink slug={item.page} title={pageTitles.get(item.page)} /></div>
                <p className="mt-3 text-muted-foreground">{item.description}</p><Separator className="my-3" /><p>{item.suggested_fix}</p>
                <Button className="mt-3" size="sm" variant="outline" asChild><Link to={pagePath(item.page)}>Open page</Link></Button>
              </div>
            ))}
          </LintSection>
        </>
      )}
    </div>
  );
}
