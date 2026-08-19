import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// Vite worker import — bundles the worker as a module URL
// @ts-ignore - vite ?url import
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface Props {
  url: string;
  /** Pixel width target; height derives from the page aspect ratio. */
  width?: number;
  className?: string;
  /** When true, render contained (object-contain). When false, cover. */
  contain?: boolean;
}

/**
 * Renders the first page of a PDF as a canvas thumbnail.
 * Falls back to a clean FileText icon on error.
 */
export function PdfThumbnail({ url, width = 320, className = "", contain = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    setStatus("loading");

    if (!url) {
      setStatus("error");
      return;
    }

    (async () => {
      try {
        const loadingTask = pdfjsLib.getDocument({ url, disableAutoFetch: true, disableStream: true });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = (width * (window.devicePixelRatio || 1)) / baseViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / (window.devicePixelRatio || 1))}px`;
        canvas.style.height = `${Math.floor(viewport.height / (window.devicePixelRatio || 1))}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setStatus("error");
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const task: any = page.render({ canvasContext: ctx, viewport, canvas } as any);
        renderTask = task;
        await task.promise;
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          console.warn("PdfThumbnail failed:", (err as Error).message);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [url, width]);

  if (status === "error") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 text-muted-foreground/70 ${className}`}>
        <FileText className="h-10 w-10" />
        <span className="text-[10px] leading-tight">PDF document</span>
      </div>
    );
  }

  return (
    <div className={`relative flex items-center justify-center w-full h-full overflow-hidden ${className}`}>
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={`max-w-full max-h-full ${contain ? "object-contain" : "object-cover w-full h-full"}`}
        style={{ display: status === "ready" ? "block" : "none" }}
      />
    </div>
  );
}
