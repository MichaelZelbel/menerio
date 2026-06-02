import { useState, useEffect, useMemo } from "react";
import { useMediaAnalysis, useReanalyzeMedia, MediaAnalysisEntry } from "@/hooks/useMediaAnalysis";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  FileText,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { MediaDetailDialog, MediaDetailItem } from "@/components/media/MediaDetailDialog";

interface Props {
  noteId: string;
}

interface GroupedAttachment {
  storage_path: string;
  original_filename: string | null;
  media_type: string;
  status: string;
  entries: MediaAnalysisEntry[];
}

export function NoteAttachmentsPanel({ noteId }: Props) {
  const { data: entries = [] } = useMediaAnalysis(noteId);
  const reanalyze = useReanalyzeMedia();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [openItem, setOpenItem] = useState<MediaDetailItem | null>(null);
  const thumbPathKey = useMemo(
    () => [...new Set(entries.map((entry) => entry.storage_path))].sort().join("\u0000"),
    [entries],
  );

  // Group PDF pages by original file
  const groups: GroupedAttachment[] = useMemo(() => {
    const map = new Map<string, GroupedAttachment>();
    for (const e of entries) {
      const key = e.media_type === "pdf_page"
        ? `pdf:${e.original_filename ?? e.storage_path.replace(/__page-\d+$/, "")}`
        : `${e.media_type}:${e.storage_path}`;
      const existing = map.get(key);
      if (existing) {
        existing.entries.push(e);
        // Failed overrides; processing overrides complete
        if (e.analysis_status === "failed") existing.status = "failed";
        else if (e.analysis_status !== "complete" && existing.status === "complete") {
          existing.status = e.analysis_status;
        }
      } else {
        map.set(key, {
          storage_path: e.storage_path,
          original_filename: e.original_filename,
          media_type: e.media_type,
          status: e.analysis_status,
          entries: [e],
        });
      }
    }
    return [...map.values()];
  }, [entries]);

  // Signed-URL thumbnails for previews
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const paths = thumbPathKey ? thumbPathKey.split("\u0000") : [];
      const out: Record<string, string> = {};
      await Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage
            .from("note-attachments")
            .createSignedUrl(path, 60 * 60);
          if (data?.signedUrl) out[path] = data.signedUrl;
        }),
      );
      if (!cancelled) setThumbs(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [thumbPathKey]);

  if (groups.length === 0) return null;

  return (
    <>
      <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          <Paperclip className="h-3 w-3" />
          Attachments & extracted content
        </div>
        <div className="space-y-1.5">
          {groups.map((g) => (
            <AttachmentRow
              key={g.entries[0].id}
              group={g}
              thumb={thumbs[g.entries[0].storage_path]}
              noteId={noteId}
              isPending={reanalyze.isPathPending(g.storage_path)}
              onRetry={() =>
                reanalyze.mutate(
                  {
                    noteId,
                    storagePath: g.storage_path,
                    mediaType: g.media_type === "pdf" || g.media_type === "pdf_page" ? "pdf" : "image",
                    originalFilename: g.original_filename ?? undefined,
                  },
                  {
                    onSuccess: () => toast.success("Reanalyzing…"),
                    onError: (err: Error) => toast.error(err.message),
                  },
                )
              }
              onOpen={() => setOpenItem(g.entries[0])}
            />
          ))}
        </div>
      </div>

      <MediaDetailDialog item={openItem} onClose={() => setOpenItem(null)} />
    </>
  );
}

interface RowProps {
  group: GroupedAttachment;
  thumb?: string;
  noteId: string;
  isPending: boolean;
  onRetry: () => void;
  onOpen: () => void;
}

function AttachmentRow({ group, thumb, isPending, onRetry, onOpen }: RowProps) {
  const [open, setOpen] = useState(false);
  const isPdf = group.media_type === "pdf" || group.media_type === "pdf_page";
  const combinedText = group.entries
    .map((e) => e.extracted_text?.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
  const description = group.entries.find((e) => e.description)?.description;
  const topics = [...new Set(group.entries.flatMap((e) => e.topics || []))];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border border-border rounded-md bg-background">
      <div className="flex items-center gap-2 px-2 py-1.5">
        {/* Thumbnail */}
        <button
          type="button"
          onClick={onOpen}
          className="h-10 w-10 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden hover:opacity-80"
          title="Open preview"
        >
          {isPdf ? (
            <FileText className="h-4 w-4 text-muted-foreground" />
          ) : thumb ? (
            <img src={thumb} alt="" className="w-full h-full object-cover" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {/* Filename + status */}
        <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
          <p className="text-xs font-medium text-foreground truncate">
            {group.original_filename || "Untitled attachment"}
          </p>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {group.entries.length > 1 && <span>{group.entries.length} pages</span>}
            <StatusInline status={isPending ? "processing" : group.status} />
          </div>
        </button>

        {/* Actions */}
        {group.status === "failed" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px]"
            disabled={isPending}
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            {isPending ? "Retrying…" : "Retry"}
          </Button>
        )}

        {(description || combinedText) && (
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
        )}
      </div>

      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border">
          {description && (
            <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{description}</p>
          )}
          {combinedText && (
            <pre className="text-[11px] text-foreground whitespace-pre-wrap leading-relaxed font-mono bg-muted/40 rounded p-2 max-h-64 overflow-y-auto">
              {combinedText}
            </pre>
          )}
          {topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {topics.map((t) => (
                <Badge key={t} variant="secondary" className="text-[9px]">{t}</Badge>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StatusInline({ status }: { status: string }) {
  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <CheckCircle2 className="h-2.5 w-2.5" /> analyzed
      </span>
    );
  }
  if (status === "pending" || status === "processing") {
    return (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> processing
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-destructive">
        <AlertCircle className="h-2.5 w-2.5" /> failed
      </span>
    );
  }
  return null;
}
