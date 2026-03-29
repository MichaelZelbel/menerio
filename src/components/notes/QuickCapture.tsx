import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateNote, useProcessNote } from "@/hooks/useNotes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/lib/toast";
import { Zap, X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TEMPLATES = [
  "Decision: [what]. Context: [why]. Owner: [who].",
  "[Name] — [what happened or what you learned about them]",
  "Insight: [the thing you realized]. Triggered by: [source]",
  "Meeting with [who] about [topic]. Key points: [notes]. Actions: [next steps]",
  "Idea: [the idea]. Why it matters: [context]",
];

export function QuickCapture() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [templateIdx, setTemplateIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createNote = useCreateNote();
  const processNote = useProcessNote();
  const navigate = useNavigate();

  // Keyboard shortcut: Cmd/Ctrl+Shift+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "K") {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) {
            setTemplateIdx((i) => (i + 1) % TEMPLATES.length);
          }
          return !prev;
        });
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus textarea when opened
  useEffect(() => {
    if (open && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  const handleOpen = useCallback(() => {
    setTemplateIdx((i) => (i + 1) % TEMPLATES.length);
    setContent("");
    setOpen(true);
  }, []);

  const handleCapture = useCallback(async () => {
    const text = content.trim();
    if (!text || !user) return;

    setSubmitting(true);
    try {
      const title = text.slice(0, 50).replace(/\n/g, " ") + (text.length > 50 ? "…" : "");
      const note = await createNote.mutateAsync({
        title,
        content: text,
      });

      setOpen(false);
      setContent("");

      showToast.success("Thought captured");

      // Background: trigger AI processing
      processNote.mutate(note.id, {
        onSuccess: (data) => {
          if (data?.metadata) {
            const meta = data.metadata as Record<string, unknown>;
            const type = meta.type || "thought";
            const topics = Array.isArray(meta.topics) ? (meta.topics as string[]).join(", ") : "";
            showToast.success(`Classified as ${type}${topics ? ` — ${topics}` : ""}`);
          }
        },
      });
    } catch {
      showToast.error("Failed to capture thought");
    } finally {
      setSubmitting(false);
    }
  }, [content, user, createNote, processNote]);

  if (!user) return null;

  return (
    <>
      {/* FAB button */}
      {!open && (
        <button
          onClick={handleOpen}
          className={cn(
            "fixed bottom-6 right-6 z-50 flex items-center justify-center",
            "h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg",
            "hover:bg-primary/90 transition-all hover:scale-105 active:scale-95",
            "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          )}
          title="Quick Capture (⌘⇧K)"
        >
          <Zap className="h-6 w-6" />
        </button>
      )}

      {/* Overlay */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Capture card */}
          <div className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-48px))] animate-in slide-in-from-bottom-4 fade-in duration-200">
            <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Quick Capture</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">⌘⇧K</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Input */}
              <div className="p-3">
                <Textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={TEMPLATES[templateIdx]}
                  className="min-h-[100px] max-h-[200px] resize-none border-none shadow-none focus-visible:ring-0 text-sm bg-transparent p-0"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleCapture();
                    }
                  }}
                />
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30">
                <span className="text-[10px] text-muted-foreground">
                  ⌘↵ to capture
                </span>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={handleCapture}
                  disabled={!content.trim() || submitting}
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Capture
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
