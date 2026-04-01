import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useMediaAnalysis, MediaAnalysisEntry } from "@/hooks/useMediaAnalysis";
import { MediaAnalysisPanel } from "./MediaAnalysisPanel";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { useReanalyzeMedia } from "@/hooks/useMediaAnalysis";

interface MediaAnalysisOverlayProps {
  noteId: string;
  editorContainerRef: React.RefObject<HTMLDivElement>;
}

interface MediaElementInfo {
  element: HTMLElement;
  src: string;
  type: "image" | "pdf";
  rect: DOMRect;
}

/**
 * Extracts the storage path segment from a Supabase storage URL.
 * URLs look like: https://xxx.supabase.co/storage/v1/object/public/note-attachments/userId/file.png
 * We need to match against the storage_path stored in media_analysis which is like: userId/file.png
 */
function extractStoragePath(url: string): string | null {
  try {
    const match = url.match(/\/note-attachments\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function findAnalysisForSrc(
  src: string,
  entries: MediaAnalysisEntry[]
): MediaAnalysisEntry[] {
  const storagePath = extractStoragePath(src);
  if (!storagePath) return [];
  return entries.filter(e => {
    // Match by storage_path directly or check if storage path ends with the entry's path
    return e.storage_path === storagePath || storagePath.endsWith(e.storage_path) || e.storage_path.endsWith(storagePath);
  });
}

export function MediaAnalysisOverlay({ noteId, editorContainerRef }: MediaAnalysisOverlayProps) {
  const { data: analysisEntries = [] } = useMediaAnalysis(noteId);
  const [mediaElements, setMediaElements] = useState<MediaElementInfo[]>([]);
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);

  const scanMedia = useCallback(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const elements: MediaElementInfo[] = [];

    // Scan images
    container.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      if (img.src && !img.closest("[data-media-overlay]")) {
        elements.push({
          element: img,
          src: img.src,
          type: "image",
          rect: img.getBoundingClientRect(),
        });
      }
    });

    // Scan PDF iframes
    container.querySelectorAll<HTMLIFrameElement>("iframe[data-type='pdf']").forEach((iframe) => {
      if (iframe.src) {
        elements.push({
          element: iframe.closest(".embed-pdf-wrapper") as HTMLElement || iframe,
          src: iframe.src,
          type: "pdf",
          rect: (iframe.closest(".embed-pdf-wrapper") || iframe).getBoundingClientRect(),
        });
      }
    });

    setMediaElements(elements);
  }, [editorContainerRef]);

  // Observe DOM changes in editor
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    scanMedia();

    observerRef.current = new MutationObserver(() => {
      // Debounce re-scan
      setTimeout(scanMedia, 200);
    });

    observerRef.current.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });

    // Re-scan on scroll/resize
    const rescan = () => setTimeout(scanMedia, 100);
    window.addEventListener("resize", rescan);
    container.addEventListener("scroll", rescan, true);

    return () => {
      observerRef.current?.disconnect();
      window.removeEventListener("resize", rescan);
      container.removeEventListener("scroll", rescan, true);
    };
  }, [editorContainerRef, scanMedia, noteId]);

  // Re-scan when analysis entries change (new entries arrive)
  useEffect(() => {
    scanMedia();
  }, [analysisEntries, scanMedia]);

  if (analysisEntries.length === 0 && mediaElements.length === 0) return null;

  return (
    <>
      {mediaElements.map((media) => {
        const matches = findAnalysisForSrc(media.src, analysisEntries);
        if (matches.length === 0) return null;

        const status = matches[0].analysis_status;
        const isExpanded = expandedSrc === media.src;
        const storagePath = extractStoragePath(media.src) || media.src;

        return (
          <MediaBadge
            key={media.src}
            element={media.element}
            status={status}
            matches={matches}
            isExpanded={isExpanded}
            onToggle={() => setExpandedSrc(isExpanded ? null : media.src)}
            noteId={noteId}
            storagePath={storagePath}
            onClosePanel={() => setExpandedSrc(null)}
          />
        );
      })}
    </>
  );
}

interface MediaBadgeProps {
  element: HTMLElement;
  status: string;
  matches: MediaAnalysisEntry[];
  isExpanded: boolean;
  onToggle: () => void;
  noteId: string;
  storagePath: string;
  onClosePanel: () => void;
}

function MediaBadge({ element, status, matches, isExpanded, onToggle, noteId, storagePath, onClosePanel }: MediaBadgeProps) {
  const reanalyze = useReanalyzeMedia();
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const parent = element.offsetParent as HTMLElement;
      if (!parent) return;
      setPos({
        top: element.offsetTop,
        left: element.offsetLeft,
        width: element.offsetWidth,
      });
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [element]);

  if (!pos) return null;

  // Ensure the element's parent has relative positioning for the badge
  if (element.parentElement) {
    element.parentElement.style.position = "relative";
  }

  const handleRetry = (e: React.MouseEvent) => {
    e.stopPropagation();
    reanalyze.mutate({
      noteId,
      storagePath,
      mediaType: matches[0].media_type === "pdf" || matches[0].media_type === "pdf_page" ? "pdf" : "image",
      originalFilename: matches[0].original_filename || undefined,
    });
  };

  const badgeContent = () => {
    switch (status) {
      case "pending":
      case "processing":
        return (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Analyzing…
          </span>
        );
      case "failed":
        return (
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 text-[10px] text-warning hover:text-warning/80 transition-colors"
          >
            <AlertTriangle className="h-3 w-3" /> Retry
          </button>
        );
      case "complete":
        return (
          <button
            onClick={onToggle}
            className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            <Sparkles className="h-3 w-3" /> AI
          </button>
        );
      default:
        return null;
    }
  };

  // Render badge using a wrapper inserted after the element
  return (
    <>
      {/* Badge - positioned absolutely at bottom-right of the media element */}
      <div
        data-media-overlay="true"
        style={{
          position: "absolute",
          top: pos.top + element.offsetHeight - 28,
          left: pos.left + pos.width - 60,
          zIndex: 10,
        }}
      >
        <div className="bg-background/90 backdrop-blur-sm border border-border rounded-md px-1.5 py-0.5 shadow-sm cursor-pointer">
          {badgeContent()}
        </div>
      </div>

      {/* Expanded panel */}
      {isExpanded && status === "complete" && (
        <div
          data-media-overlay="true"
          style={{
            position: "absolute",
            top: pos.top + element.offsetHeight + 4,
            left: pos.left,
            width: Math.min(pos.width, 500),
            zIndex: 10,
          }}
        >
          <MediaAnalysisPanel
            entries={matches}
            noteId={noteId}
            onClose={onClosePanel}
            storagePath={storagePath}
          />
        </div>
      )}
    </>
  );
}
