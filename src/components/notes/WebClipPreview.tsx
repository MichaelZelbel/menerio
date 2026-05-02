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
  defaultOpen?: boolean;
}

/**
 * Renders the saved SingleFile HTML snapshot inside a sandboxed iframe.
 * We fetch the HTML as text and inject it via `srcDoc` so the browser
 * always renders it as HTML (some browsers/extensions display Supabase
 * Storage responses as plain text when loaded via `src`). Scripts are
 * blocked via the sandbox attribute (no `allow-scripts`) and we inject
 * a meta CSP for belt-and-suspenders.
 */
export function WebClipPreview({ webClip, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storagePath = webClip.snapshot_storage_path;

  useEffect(() => {
    if (!open || !storagePath || html) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data: signed, error: signedErr } = await supabase.storage
          .from("note-attachments")
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
        if (signedErr || !signed) {
          throw new Error(signedErr?.message || "Could not sign snapshot URL.");
        }
        if (!cancelled) setSignedUrl(signed.signedUrl);

        const res = await fetch(signed.signedUrl);
        if (!res.ok) throw new Error(`Snapshot fetch failed (${res.status}).`);
        let text = await res.text();

        // Neutralize <base> tags so relative URLs don't try to hit external origins.
        text = text.replace(/<base\b[^>]*>/gi, "");

        // Inject a strict CSP meta to block scripts even if sandbox flags vary.
        const csp =
          `<meta http-equiv="Content-Security-Policy" content="` +
          `default-src 'self' data: blob: https:; ` +
          `img-src * data: blob:; ` +
          `style-src * 'unsafe-inline' data:; ` +
          `font-src * data:; ` +
          `script-src 'none'; ` +
          `frame-src 'none'; ` +
          `object-src 'none';">`;
        if (/<head[^>]*>/i.test(text)) {
          text = text.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
        } else {
          text = `<!doctype html><html><head>${csp}</head><body>${text}</body></html>`;
        }

        if (!cancelled) setHtml(text);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "Could not load snapshot.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, storagePath, html]);

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
            <div className="h-[700px] flex items-center justify-center text-xs text-muted-foreground bg-background rounded-lg border border-border">
              Loading snapshot…
            </div>
          )}
          {error && (
            <div className="h-[120px] flex items-center justify-center text-xs text-destructive bg-background rounded-lg border border-border">
              {error}
            </div>
          )}
          {!loading && !error && html && (
            <iframe
              srcDoc={html}
              title="Page snapshot"
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              loading="lazy"
              className="w-full h-[700px] rounded-lg border border-border bg-white"
            />
          )}
        </div>
      )}
    </div>
  );
}
