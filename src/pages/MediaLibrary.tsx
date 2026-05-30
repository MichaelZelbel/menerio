import { useState, useMemo, useCallback } from "react";
import { SEOHead } from "@/components/SEOHead";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Image,
  FileText,
  CheckCircle2,
  Loader2,
  AlertCircle,
  X,
  Play,
  Square,
  Sparkles,
  RefreshCw,
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useReanalyzeMedia } from "@/hooks/useMediaAnalysis";
import { MediaDetailDialog, MediaDetailItem } from "@/components/media/MediaDetailDialog";

interface MediaItem {
  id: string;
  note_id: string;
  storage_path: string;
  media_type: string;
  page_number: number | null;
  original_filename: string | null;
  description: string | null;
  extracted_text: string | null;
  topics: string[] | null;
  raw_analysis: Record<string, unknown> | null;
  analysis_status: string;
  created_at: string | null;
  updated_at: string | null;
}

interface DocumentGroup {
  key: string;
  note_id: string;
  storage_path: string;
  media_type: string;
  original_filename: string | null;
  analysis_status: string;
  description: string | null;
  extracted_text: string | null;
  topics: string[];
  raw_analysis: Record<string, unknown> | null;
  created_at: string | null;
  page_count: number;
  duplicate_count: number;
  representative: MediaItem;
}

function groupMediaByDocument(items: MediaItem[]): DocumentGroup[] {
  const map = new Map<string, DocumentGroup>();
  // Items are sorted desc by created_at; iterate so page 1 wins when present.
  const sorted = [...items].sort((a, b) => {
    const pa = a.page_number ?? -1;
    const pb = b.page_number ?? -1;
    return pa - pb;
  });

  for (const item of sorted) {
    const key = `${item.note_id}::${item.storage_path}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        key,
        note_id: item.note_id,
        storage_path: item.storage_path,
        media_type: item.media_type,
        original_filename: item.original_filename,
        analysis_status: item.analysis_status,
        description: item.description,
        extracted_text: item.extracted_text,
        topics: [...(item.topics || [])],
        raw_analysis: item.raw_analysis,
        created_at: item.created_at,
        page_count: 1,
        duplicate_count: 1,
        representative: item,
      });
      continue;
    }

    existing.page_count += 1;

    // Status precedence: failed > processing/pending > complete
    const rank = (s: string) =>
      s === "failed" ? 3 : s === "processing" || s === "pending" ? 2 : 1;
    if (rank(item.analysis_status) > rank(existing.analysis_status)) {
      existing.analysis_status = item.analysis_status;
    }

    // Merge text & description (page order due to pre-sort)
    if (item.description) {
      existing.description = existing.description
        ? `${existing.description}\n\n${item.description}`
        : item.description;
    }
    if (item.extracted_text) {
      existing.extracted_text = existing.extracted_text
        ? `${existing.extracted_text}\n\n— Page ${item.page_number ?? "?"} —\n\n${item.extracted_text}`
        : item.extracted_text;
    }

    // Deduplicate topics
    const topicSet = new Set(existing.topics);
    for (const t of item.topics || []) topicSet.add(t);
    existing.topics = [...topicSet];

    // Keep the earliest created_at as the document's age
    if (item.created_at && existing.created_at && item.created_at < existing.created_at) {
      existing.created_at = item.created_at;
    }
  }

  return [...map.values()];
}


const CONTENT_TYPES = [
  "all",
  "screenshot",
  "photo",
  "diagram",
  "chart",
  "whiteboard",
  "document",
  "handwriting",
  "ui_mockup",
  "code",
  "other",
];

// Average tokens per image analysis (~500 prompt + ~200 completion)
const AVG_TOKENS_PER_IMAGE = 700;
const TOKENS_PER_CREDIT = 200;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

function BatchAnalysisPanel() {
  const [scanResult, setScanResult] = useState<{
    unanalyzed_images: number;
    unanalyzed_pdfs: number;
    unanalyzed_total: number;
    total_media: number;
    already_analyzed: number;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number; failed: number } | null>(null);
  const [stopRequested, setStopRequested] = useState(false);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/backfill-media-analysis`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "scan" }),
      });

      if (!resp.ok) throw new Error("Scan failed");
      const result = await resp.json();
      setScanResult(result);
    } catch (err: any) {
      toast.error("Failed to scan: " + err.message);
    } finally {
      setScanning(false);
    }
  }, []);

  const handleRun = useCallback(async () => {
    if (!scanResult || scanResult.unanalyzed_total === 0) return;
    setRunning(true);
    setStopRequested(false);
    setProgress({ processed: 0, total: scanResult.unanalyzed_total, failed: 0 });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/backfill-media-analysis`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "run", batch_size: 5, delay_ms: 2000 }),
      });

      if (!resp.ok) throw new Error("Backfill failed");
      const result = await resp.json();
      setProgress({ processed: result.processed, total: result.total, failed: result.failed || 0 });
      toast.success(result.message);
      // Refresh scan
      setScanResult(prev => prev ? {
        ...prev,
        unanalyzed_total: Math.max(0, prev.unanalyzed_total - (result.processed || 0)),
        unanalyzed_images: 0,
        unanalyzed_pdfs: 0,
        already_analyzed: prev.already_analyzed + (result.processed || 0),
      } : null);
    } catch (err: any) {
      toast.error("Backfill failed: " + err.message);
    } finally {
      setRunning(false);
    }
  }, [scanResult]);

  const estimatedCredits = scanResult
    ? Math.ceil((scanResult.unanalyzed_total * AVG_TOKENS_PER_IMAGE) / TOKENS_PER_CREDIT)
    : 0;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Batch Media Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!scanResult ? (
          <div className="flex items-center gap-3">
            <p className="text-xs text-muted-foreground flex-1">
              Scan your notes to find unanalyzed images and PDFs.
            </p>
            <Button size="sm" variant="outline" onClick={handleScan} disabled={scanning}>
              {scanning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
              Scan
            </Button>
          </div>
        ) : scanResult.unanalyzed_total === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            All {scanResult.total_media} media items are analyzed.
            <Button size="sm" variant="ghost" className="ml-auto text-xs" onClick={handleScan} disabled={scanning}>
              Re-scan
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Found <strong>{scanResult.unanalyzed_images}</strong> unanalyzed images
                {scanResult.unanalyzed_pdfs > 0 && <> and <strong>{scanResult.unanalyzed_pdfs}</strong> PDFs</>}
              </span>
              <span className="text-muted-foreground">
                Est. cost: ~{estimatedCredits} credits
              </span>
            </div>

            {progress && (
              <div className="space-y-1">
                <Progress value={(progress.processed / progress.total) * 100} className="h-2" />
                <p className="text-[10px] text-muted-foreground">
                  {progress.processed} of {progress.total} processed
                  {progress.failed > 0 && <>, {progress.failed} failed</>}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              {!running ? (
                <Button size="sm" onClick={handleRun}>
                  <Play className="h-3 w-3 mr-1" />
                  Start analysis
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => setStopRequested(true)} disabled={stopRequested}>
                  <Square className="h-3 w-3 mr-1" />
                  {stopRequested ? "Stopping…" : "Stop"}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleScan} disabled={scanning || running}>
                Re-scan
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MediaLibrary() {
  const { user } = useAuth();
  const reanalyze = useReanalyzeMedia();
  const [searchQuery, setSearchQuery] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");
  const [openItem, setOpenItem] = useState<MediaDetailItem | null>(null);
  const [brokenPreviews, setBrokenPreviews] = useState<Record<string, true>>({});

  const { data: mediaItems = [], isLoading } = useQuery({
    queryKey: ["media-library", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_analysis")
        .select("id, note_id, storage_path, media_type, page_number, original_filename, description, extracted_text, topics, raw_analysis, analysis_status, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as MediaItem[];
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const items = query.state.data as MediaItem[] | undefined;
      if (
        reanalyze.hasActivePendingJobs() ||
        items?.some((m) => m.analysis_status === "pending" || m.analysis_status === "processing")
      ) {
        return 3000;
      }
      return false;
    },
  });

  // Load attachment metadata so we can collapse byte-identical duplicates
  // (same sha256 within the same note) into a single media library card.
  const storagePaths = useMemo(
    () => [...new Set(mediaItems.map((m) => m.storage_path).filter(Boolean))],
    [mediaItems],
  );
  const { data: attachmentMeta = {} } = useQuery({
    queryKey: ["media-library-attachment-meta", user?.id, storagePaths.join("|")],
    queryFn: async () => {
      if (storagePaths.length === 0) return {} as Record<string, { sha256: string | null; created_at: string | null }>;
      const { data } = await supabase
        .from("note_attachments")
        .select("storage_path, sha256, created_at")
        .in("storage_path", storagePaths);
      const map: Record<string, { sha256: string | null; created_at: string | null }> = {};
      (data || []).forEach((row: { storage_path: string; sha256: string | null; created_at: string | null }) => {
        map[row.storage_path] = { sha256: row.sha256, created_at: row.created_at };
      });
      return map;
    },
    enabled: !!user && storagePaths.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // For each (note_id, sha256) pick a canonical storage_path = oldest attachment.
  const canonicalPathByDuplicateKey = useMemo(() => {
    const byKey = new Map<string, { storage_path: string; created_at: string }[]>();
    for (const m of mediaItems) {
      const meta = attachmentMeta[m.storage_path];
      if (!meta?.sha256) continue;
      const key = `${m.note_id}::${meta.sha256}`;
      const arr = byKey.get(key) || [];
      if (!arr.find((p) => p.storage_path === m.storage_path)) {
        arr.push({ storage_path: m.storage_path, created_at: meta.created_at || "" });
      }
      byKey.set(key, arr);
    }
    const result: Record<string, string> = {};
    for (const [, paths] of byKey) {
      const canonical = [...paths].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      for (const p of paths) result[p.storage_path] = canonical.storage_path;
    }
    return result;
  }, [mediaItems, attachmentMeta]);

  // Collapse duplicate uploads: items whose storage_path maps to a different
  // canonical path are filtered out (their content is folded into the
  // canonical group's duplicate_count below).
  const dedupedMediaItems = useMemo(() => {
    return mediaItems.filter((m) => {
      const canonical = canonicalPathByDuplicateKey[m.storage_path];
      return !canonical || canonical === m.storage_path;
    });
  }, [mediaItems, canonicalPathByDuplicateKey]);

  const duplicateCountByCanonical = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of mediaItems) {
      const canonical = canonicalPathByDuplicateKey[m.storage_path] || m.storage_path;
      const key = `${m.note_id}::${canonical}`;
      counts[key] = (counts[key] || 0) + (m.storage_path === canonical ? 0 : 1);
    }
    return counts;
  }, [mediaItems, canonicalPathByDuplicateKey]);

  const { data: signedUrls = {} } = useQuery({
    queryKey: ["media-library-signed-urls", mediaItems.map((m) => m.storage_path).join("|")],
    queryFn: async () => {
      const paths = [...new Set(mediaItems.map((m) => m.storage_path).filter(Boolean))];
      const entries = await Promise.all(
        paths.map(async (path) => {
          const { data, error } = await supabase.storage
            .from("note-attachments")
            .createSignedUrl(path, 60 * 60);
          return [path, error ? "" : data.signedUrl] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, string>;
    },
    enabled: !!user && mediaItems.length > 0,
    staleTime: 45 * 60 * 1000,
  });

  // Fetch note titles for all unique note IDs
  const noteIds = useMemo(() => [...new Set(mediaItems.map(m => m.note_id))], [mediaItems]);
  const { data: noteTitles = {} } = useQuery({
    queryKey: ["media-library-notes", noteIds],
    queryFn: async () => {
      if (noteIds.length === 0) return {};
      const { data } = await supabase
        .from("notes")
        .select("id, title")
        .in("id", noteIds);
      const map: Record<string, string> = {};
      (data || []).forEach((n: any) => { map[n.id] = n.title; });
      return map;
    },
    enabled: noteIds.length > 0,
  });

  const documentGroups = useMemo(() => groupMediaByDocument(mediaItems), [mediaItems]);

  const stats = useMemo(() => {
    const complete = documentGroups.filter(g => g.analysis_status === "complete").length;
    const pending = documentGroups.filter(g =>
      g.analysis_status === "pending" ||
      g.analysis_status === "processing" ||
      reanalyze.isPathPending(g.storage_path)
    ).length;
    const failed = documentGroups.filter(g => g.analysis_status === "failed").length;
    return { total: documentGroups.length, complete, pending, failed };
  }, [documentGroups, reanalyze]);

  const filteredGroups = useMemo(() => {
    let groups = documentGroups;

    if (contentTypeFilter !== "all") {
      groups = groups.filter(g => {
        const raw = g.raw_analysis as Record<string, unknown> | null;
        return raw?.content_type === contentTypeFilter;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      groups = groups.filter(g =>
        (g.description || "").toLowerCase().includes(q) ||
        (g.extracted_text || "").toLowerCase().includes(q) ||
        (g.original_filename || "").toLowerCase().includes(q) ||
        g.topics.some(t => t.toLowerCase().includes(q))
      );
    }

    return groups;
  }, [documentGroups, contentTypeFilter, searchQuery]);

  const getMediaUrl = (storagePath: string) => signedUrls[storagePath] || "";

  // Build a synthetic detail item from the matching group (always use the
  // grouped content so the dialog shows the full multi-page document).
  const selectedOpenItem: MediaDetailItem | null = openItem
    ? (() => {
        const group = documentGroups.find(
          (g) => g.note_id === openItem.note_id && g.storage_path === openItem.storage_path,
        );
        if (!group) return openItem;
        return {
          id: group.representative.id,
          note_id: group.note_id,
          storage_path: group.storage_path,
          media_type: group.media_type,
          page_number: group.page_count > 1 ? null : group.representative.page_number,
          original_filename: group.original_filename,
          description: group.description,
          extracted_text: group.extracted_text,
          topics: group.topics,
          raw_analysis: group.raw_analysis,
          analysis_status: group.analysis_status,
        };
      })()
    : null;


  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <SEOHead title="Media Library — Menerio" noIndex />

      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold font-display">Media Library</h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-success" />
              {stats.complete} analyzed
            </span>
            {stats.pending > 0 && (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {stats.pending} pending
              </span>
            )}
            {stats.failed > 0 && (
              <span className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-destructive" />
                {stats.failed} failed
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search media by description, text, filename…"
              className="pl-8 h-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <Select value={contentTypeFilter} onValueChange={setContentTypeFilter}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Content type" />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_TYPES.map(t => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t === "all" ? "All types" : t.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Batch Analysis Panel */}
        <BatchAnalysisPanel />

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-36 w-full rounded-lg" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Image className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">No media found</p>
            <p className="text-xs mt-1">Upload images or PDFs to your notes to see them here</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredGroups.map((group) => {
              const raw = group.raw_analysis as Record<string, unknown> | null;
              const contentType = raw?.content_type as string | undefined;
              const noteTitle = noteTitles[group.note_id] || "Untitled";
              const isPdf = group.media_type === "pdf" || group.media_type === "pdf_page";

              const isRetrying = reanalyze.isPathPending(group.storage_path);
              const previewUrl = getMediaUrl(group.storage_path);
              const hasBrokenPreview = Boolean(brokenPreviews[group.storage_path]);
              const status = isRetrying ? "processing" : group.analysis_status;
              const canRetry = !isRetrying && (status === "failed" || status === "complete" || hasBrokenPreview);

              const openDocument = () =>
                setOpenItem({
                  id: group.representative.id,
                  note_id: group.note_id,
                  storage_path: group.storage_path,
                  media_type: group.media_type,
                  page_number: group.page_count > 1 ? null : group.representative.page_number,
                  original_filename: group.original_filename,
                  description: group.description,
                  extracted_text: group.extracted_text,
                  topics: group.topics,
                  raw_analysis: group.raw_analysis,
                  analysis_status: group.analysis_status,
                });

              const retryItem = () => {
                reanalyze.mutate(
                  {
                    noteId: group.note_id,
                    storagePath: group.storage_path,
                    mediaType: isPdf ? "pdf" : "image",
                    originalFilename: group.original_filename ?? undefined,
                  },
                  {
                    onSuccess: () => toast.success("Reanalyzing…"),
                    onError: (err: Error) => toast.error(err.message),
                  }
                );
              };

              return (
                <div
                  key={group.key}
                  role="button"
                  tabIndex={0}
                  onClick={openDocument}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openDocument();
                    }
                  }}
                  className="group text-left rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors overflow-hidden"
                >
                  {/* Thumbnail */}
                  <div className="relative h-36 bg-muted flex items-center justify-center overflow-hidden">
                    {isPdf || hasBrokenPreview || !previewUrl ? (
                      <div className="flex flex-col items-center gap-2 text-muted-foreground/70 px-3 text-center">
                        {isPdf ? <FileText className="h-10 w-10" /> : <Image className="h-10 w-10" />}
                        <span className="text-[10px] leading-tight">
                          {hasBrokenPreview ? "Preview unavailable" : isPdf ? "PDF document" : "Loading preview…"}
                        </span>
                      </div>
                    ) : (
                      <img
                        src={previewUrl}
                        alt={group.description || group.original_filename || "Media preview"}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => setBrokenPreviews((prev) => ({ ...prev, [group.storage_path]: true }))}
                      />
                    )}
                    {/* Status badge */}
                    <div className="absolute top-1.5 right-1.5 z-10">
                      {status === "complete" && !hasBrokenPreview && (
                        <span className="bg-success/90 text-success-foreground text-[9px] px-1.5 py-0.5 rounded-full">
                          ✓
                        </span>
                      )}
                      {(status === "pending" || status === "processing") && (
                        <span className="flex items-center gap-1 bg-background/90 text-muted-foreground text-[9px] px-1.5 py-0.5 rounded-full">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          {isRetrying ? "Retrying…" : "Analyzing…"}
                        </span>
                      )}
                      {canRetry && (
                        <button
                          type="button"
                          title={group.original_filename ? `Retry: ${group.original_filename}` : "Retry analysis"}
                          onClick={(e) => {
                            e.stopPropagation();
                            retryItem();
                          }}
                          className="flex items-center gap-1 bg-background/90 hover:bg-accent text-foreground border border-border text-[9px] px-1.5 py-0.5 rounded-full"
                        >
                          <RefreshCw className="h-2.5 w-2.5" />
                          {status === "complete" ? "Re-analyze" : "Retry"}
                        </button>
                      )}
                    </div>
                    {contentType && (
                      <Badge variant="secondary" className="absolute bottom-1.5 left-1.5 text-[9px] z-10">
                        {contentType.replace("_", " ")}
                      </Badge>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2.5 space-y-1">
                    <p className="text-xs text-foreground font-medium truncate">{noteTitle}</p>
                    {group.original_filename && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {group.original_filename}
                        {group.page_count > 1 && <span className="ml-1 opacity-70">· {group.page_count} pages</span>}
                      </p>
                    )}
                    {group.description && (
                      <p className="text-[10px] text-muted-foreground line-clamp-2">{group.description}</p>
                    )}
                    <div className="flex items-center gap-1 flex-wrap">
                      {group.topics.slice(0, 3).map((topic) => (
                        <span key={topic} className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary">
                          {topic}
                        </span>
                      ))}
                    </div>
                    {group.created_at && (
                      <p className="text-[9px] text-muted-foreground/60">
                        {formatDistanceToNow(new Date(group.created_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>


      <MediaDetailDialog
        item={selectedOpenItem}
        noteTitle={selectedOpenItem ? noteTitles[selectedOpenItem.note_id] : undefined}
        onClose={() => setOpenItem(null)}
      />
    </div>
  );
}
