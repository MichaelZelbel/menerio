import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, ExternalLink, Loader2, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useReanalyzeMedia } from "@/hooks/useMediaAnalysis";
import { toast } from "sonner";

export interface MediaDetailItem {
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
}

interface Props {
  item: MediaDetailItem | null;
  noteTitle?: string;
  onClose: () => void;
}

export function MediaDetailDialog({ item, noteTitle, onClose }: Props) {
  const navigate = useNavigate();
  const reanalyze = useReanalyzeMedia();
  const [signedUrl, setSignedUrl] = useState<string>("");
  const [previewFailed, setPreviewFailed] = useState(false);

  const isPdf = item?.media_type === "pdf" || item?.media_type === "pdf_page";

  useEffect(() => {
    setPreviewFailed(false);
    setSignedUrl("");
    if (!item) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.storage
        .from("note-attachments")
        .createSignedUrl(item.storage_path, 60 * 60);
      if (!cancelled && data?.signedUrl) setSignedUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) return null;

  const contentType = (item.raw_analysis as Record<string, unknown> | null)?.content_type as string | undefined;
  const isPending = reanalyze.isPathPending(item.storage_path);
  const effectiveStatus = isPending ? "processing" : item.analysis_status;

  const handleRetry = () => {
    reanalyze.mutate(
      {
        noteId: item.note_id,
        storagePath: item.storage_path,
        mediaType: isPdf ? "pdf" : "image",
        originalFilename: item.original_filename ?? undefined,
      },
      {
        onSuccess: () => toast.success("Reanalyzing…"),
        onError: (err: Error) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] h-[85vh] p-0 overflow-hidden flex flex-col md:flex-row gap-0">
        <DialogTitle className="sr-only">{item.original_filename || "Media detail"}</DialogTitle>

        {/* Preview */}
        <div className="flex-1 min-h-[40vh] md:min-h-0 bg-muted/40 flex items-center justify-center overflow-hidden">
          {isPdf ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground px-6 text-center">
              <FileText className="h-14 w-14" />
              <div className="space-y-1">
                <p className="text-sm text-foreground">PDF document</p>
                <p className="text-xs">Use Open file to view the original PDF.</p>
              </div>
              {signedUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a href={signedUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open file
                  </a>
                </Button>
              )}
            </div>
          ) : !signedUrl ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : previewFailed ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <FileText className="h-12 w-12" />
              <span className="text-xs">Preview unavailable</span>
            </div>
          ) : (
            <img
              src={signedUrl}
              alt={item.description || item.original_filename || "Media preview"}
              className="max-w-full max-h-full object-contain"
              onError={() => setPreviewFailed(true)}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="w-full md:w-[380px] md:border-l border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border space-y-1.5">
            <p className="text-sm font-medium text-foreground truncate" title={item.original_filename || ""}>
              {item.original_filename || "Untitled file"}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              {noteTitle && <span className="truncate max-w-[180px]">{noteTitle}</span>}
              {item.page_number != null && <span>Page {item.page_number}</span>}
              {contentType && <Badge variant="secondary" className="text-[9px]">{contentType.replace("_", " ")}</Badge>}
              <StatusBadge status={effectiveStatus} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
            {item.description && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Description
                </h4>
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{item.description}</p>
              </section>
            )}

            {item.extracted_text && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Extracted text
                </h4>
                <pre className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed font-mono bg-muted/40 rounded p-2 max-h-[40vh] overflow-y-auto">
                  {item.extracted_text}
                </pre>
              </section>
            )}

            {item.topics && item.topics.length > 0 && (
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Topics
                </h4>
                <div className="flex flex-wrap gap-1">
                  {item.topics.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                  ))}
                </div>
              </section>
            )}

            {!item.description && !item.extracted_text && item.analysis_status === "failed" && (
              <p className="text-xs text-muted-foreground">No content extracted yet. Try retrying analysis.</p>
            )}
          </div>

          <div className="px-4 py-3 border-t border-border flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                onClose();
                navigate(`/dashboard/notes/${item.note_id}`);
              }}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Open note
            </Button>
            {(item.analysis_status === "failed" || item.analysis_status === "complete" || previewFailed) && (
              <Button variant="secondary" size="sm" disabled={isPending} onClick={handleRetry}>
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                {isPending ? "Retrying…" : "Re-analyze"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "complete") {
    return (
      <span className="flex items-center gap-1 text-success">
        <CheckCircle2 className="h-3 w-3" /> analyzed
      </span>
    );
  }
  if (status === "pending" || status === "processing") {
    return (
      <span className="flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> processing
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-destructive">
        <AlertCircle className="h-3 w-3" /> failed
      </span>
    );
  }
  return null;
}
