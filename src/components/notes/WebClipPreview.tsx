import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface WebClipMetadata {
  url?: string | null;
  hostname?: string | null;
  snapshot_storage_path?: string | null;
  snapshot_attachment?: string | null;
}

interface Props {
  webClip: WebClipMetadata;
}

/**
 * Renders the saved SingleFile HTML snapshot inside a sandboxed iframe so the
 * user sees the page exactly as it was clipped. Scripts are blocked via the
 * sandbox attribute (no `allow-scripts`) and `referrerpolicy="no-referrer"`
 * suppresses any tracking pixels in the captured HTML.
 */
export function WebClipPreview({ webClip }: Props) {
  const [open, setOpen] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storagePath = webClip.snapshot_storage_path;

  useEffect(() => {
    if (!open || !storagePath || signedUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase.storage
      .from("note-attachments")
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setError(error?.message || "Could not load snapshot.");
        } else {
          setSignedUrl(data.signedUrl);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, storagePath, signedUrl]);

  if (!storagePath) return null;

  return (
    <div className="border-t border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <Globe className="h-3.5 w-3.5" />
          Page snapshot
          {webClip.hostname && (
            <span className="font-normal text-muted-foreground/70">
              · {webClip.hostname}
            </span>
          )}
        </span>
        {open && signedUrl && (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open full page <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {loading && (
            <div className="h-[500px] flex items-center justify-center text-xs text-muted-foreground bg-background rounded-lg border border-border">
              Loading snapshot…
            </div>
          )}
          {error && (
            <div className="h-[120px] flex items-center justify-center text-xs text-destructive bg-background rounded-lg border border-border">
              {error}
            </div>
          )}
          {!loading && !error && signedUrl && (
            <iframe
              src={signedUrl}
              title="Page snapshot"
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              loading="lazy"
              className="w-full h-[500px] rounded-lg border border-border bg-background"
            />
          )}
        </div>
      )}
    </div>
  );
}
