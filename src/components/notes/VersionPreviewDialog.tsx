import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor } from "@/components/RichTextEditor";
import { normalizeNoteContent, stripLeadingH1 } from "@/lib/note-content";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commitSha: string | null;
  commitDate?: string | null;
  commitAuthor?: string | null;
  commitMessage?: string | null;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Title/content parsed from the historical file */
  versionTitle: string;
  versionContent: string;
  /** Current note, for the compare toggle */
  currentTitle: string;
  currentContent: string;
  onRestore: () => Promise<void> | void;
  isRestoring: boolean;
}

export function VersionPreviewDialog({
  open,
  onOpenChange,
  commitSha,
  commitDate,
  commitAuthor,
  commitMessage,
  isLoading,
  error,
  onRetry,
  versionTitle,
  versionContent,
  currentTitle,
  currentContent,
  onRestore,
  isRestoring,
}: Props) {
  const [mode, setMode] = useState<"version" | "current">("version");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const showingCurrent = mode === "current";
  const title = showingCurrent ? currentTitle : versionTitle;
  const raw = showingCurrent ? currentContent : versionContent;
  const body = normalizeNoteContent(stripLeadingH1(raw ?? "", title ?? ""));

  const dateLabel = commitDate
    ? `${format(new Date(commitDate), "d MMM yyyy, HH:mm")} · ${formatDistanceToNow(new Date(commitDate), {
        addSuffix: true,
      })}`
    : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setMode("version");
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-3xl w-[92vw] max-h-[88vh] flex flex-col gap-3">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-base">{title || "Untitled"}</DialogTitle>
            <DialogDescription className="text-xs">
              {commitSha && <span className="font-mono">{commitSha.slice(0, 7)}</span>}
              {dateLabel && <span>{commitSha ? " · " : ""}{dateLabel}</span>}
              {commitAuthor && <span> · {commitAuthor}</span>}
              {commitMessage && <span className="block truncate">{commitMessage}</span>}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant={showingCurrent ? "ghost" : "secondary"}
              className="h-7 text-xs"
              onClick={() => setMode("version")}
            >
              This version
            </Button>
            <Button
              size="sm"
              variant={showingCurrent ? "secondary" : "ghost"}
              className="h-7 text-xs"
              onClick={() => setMode("current")}
            >
              Current version
            </Button>
            {showingCurrent && (
              <Badge variant="outline" className="ml-1 text-[10px]">
                Live note
              </Badge>
            )}
          </div>

          <ScrollArea className="flex-1 min-h-[240px] max-h-[58vh] rounded-md border border-border">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error && !showingCurrent ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center px-6">
                <p className="text-xs text-muted-foreground">{error}</p>
                {onRetry && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetry}>
                    Try again
                  </Button>
                )}
              </div>
            ) : !body.trim() ? (
              <div className="flex h-40 items-center justify-center">
                <p className="text-xs text-muted-foreground">This version has no content.</p>
              </div>
            ) : (
              <RichTextEditor
                value={body}
                editable={false}
                showToolbar={false}
                className="border-0 rounded-none"
              />
            )}
          </ScrollArea>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={isLoading || !!error || isRestoring || !versionContent}
              onClick={() => setConfirmOpen(true)}
            >
              {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Restore this version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current note with the version from{" "}
              {commitDate ? format(new Date(commitDate), "d MMM yyyy, HH:mm") : "this commit"}. Your current content
              stays available in the version history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                await onRestore();
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
