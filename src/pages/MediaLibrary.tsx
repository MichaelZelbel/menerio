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
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const SUPABASE_URL = "https://tjeapelvjlmbxafsmjef.supabase.co";

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
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState("all");

  const { data: mediaItems = [], isLoading } = useQuery({
    queryKey: ["media-library", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_analysis")
        .select("id, note_id, storage_path, media_type, page_number, original_filename, description, extracted_text, topics, raw_analysis, analysis_status, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as MediaItem[];
    },
    enabled: !!user,
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

  const stats = useMemo(() => {
    const complete = mediaItems.filter(m => m.analysis_status === "complete").length;
    const pending = mediaItems.filter(m => m.analysis_status === "pending" || m.analysis_status === "processing").length;
    const failed = mediaItems.filter(m => m.analysis_status === "failed").length;
    return { total: mediaItems.length, complete, pending, failed };
  }, [mediaItems]);

  const filteredItems = useMemo(() => {
    let items = mediaItems;

    if (contentTypeFilter !== "all") {
      items = items.filter(m => {
        const raw = m.raw_analysis as Record<string, unknown> | null;
        return raw?.content_type === contentTypeFilter;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(m =>
        (m.description || "").toLowerCase().includes(q) ||
        (m.extracted_text || "").toLowerCase().includes(q) ||
        (m.original_filename || "").toLowerCase().includes(q) ||
        (m.topics || []).some(t => t.toLowerCase().includes(q))
      );
    }

    return items;
  }, [mediaItems, contentTypeFilter, searchQuery]);

  const getMediaUrl = (storagePath: string) =>
    `${SUPABASE_URL}/storage/v1/object/public/note-attachments/${storagePath}`;

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
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Image className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">No media found</p>
            <p className="text-xs mt-1">Upload images or PDFs to your notes to see them here</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredItems.map((item) => {
              const raw = item.raw_analysis as Record<string, unknown> | null;
              const contentType = raw?.content_type as string | undefined;
              const noteTitle = noteTitles[item.note_id] || "Untitled";
              const isPdf = item.media_type === "pdf" || item.media_type === "pdf_page";

              return (
                <button
                  key={item.id}
                  onClick={() => navigate(`/dashboard/notes/${item.note_id}`)}
                  className="group text-left rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors overflow-hidden"
                >
                  {/* Thumbnail */}
                  <div className="relative h-36 bg-muted flex items-center justify-center overflow-hidden">
                    {isPdf ? (
                      <FileText className="h-12 w-12 text-muted-foreground/30" />
                    ) : (
                      <img
                        src={getMediaUrl(item.storage_path)}
                        alt={item.description || ""}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}
                    {/* Status badge */}
                    <div className="absolute top-1.5 right-1.5">
                      {item.analysis_status === "complete" && (
                        <span className="bg-success/90 text-success-foreground text-[9px] px-1.5 py-0.5 rounded-full">
                          ✓
                        </span>
                      )}
                      {(item.analysis_status === "pending" || item.analysis_status === "processing") && (
                        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                      )}
                      {item.analysis_status === "failed" && (
                        <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                    </div>
                    {contentType && (
                      <Badge variant="secondary" className="absolute bottom-1.5 left-1.5 text-[9px]">
                        {contentType.replace("_", " ")}
                      </Badge>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2.5 space-y-1">
                    <p className="text-xs text-foreground font-medium truncate">{noteTitle}</p>
                    {item.description && (
                      <p className="text-[10px] text-muted-foreground line-clamp-2">{item.description}</p>
                    )}
                    <div className="flex items-center gap-1 flex-wrap">
                      {item.topics?.slice(0, 3).map(topic => (
                        <span key={topic} className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary">
                          {topic}
                        </span>
                      ))}
                    </div>
                    {item.created_at && (
                      <p className="text-[9px] text-muted-foreground/60">
                        {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
