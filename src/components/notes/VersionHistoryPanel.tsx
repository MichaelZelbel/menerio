import { useState } from "react";
import { useGitHubVersionHistory, useGitHubFileAtCommit, useSyncLogForNote } from "@/hooks/useGitHubSync";
import { markdownToNote } from "@/utils/markdown-converter";
import { useUpdateNote } from "@/hooks/useNotes";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, GitCommit, RotateCcw, X, ChevronRight } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { showToast } from "@/lib/toast";

interface Props {
  noteId: string;
  onClose: () => void;
}

export function VersionHistoryPanel({ noteId, onClose }: Props) {
  const { data: versions, isLoading } = useGitHubVersionHistory(noteId);
  const { data: syncLog } = useSyncLogForNote(noteId);
  const fetchFile = useGitHubFileAtCommit();
  const updateNote = useUpdateNote();
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);

  const handleViewVersion = async (commitSha: string) => {
    if (!syncLog?.github_path) return;
    setSelectedSha(commitSha);
    try {
      const content = await fetchFile.mutateAsync({ path: syncLog.github_path, commitSha });
      setPreviewContent(content);
    } catch {
      showToast.error("Failed to load version");
    }
  };

  const handleRestore = async () => {
    if (!previewContent) return;
    try {
      const parsed = markdownToNote(previewContent);
      await updateNote.mutateAsync({
        id: noteId,
        title: parsed.title,
        content: parsed.content,
      });
      showToast.success("Version restored");
      setSelectedSha(null);
      setPreviewContent(null);
    } catch {
      showToast.error("Failed to restore version");
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-border bg-background w-80">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <GitCommit className="h-3.5 w-3.5 text-primary" />
          Version History
        </h4>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !versions?.length ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No version history yet. Versions are created when notes are synced to GitHub.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {versions.map((commit: any) => (
              <button
                key={commit.sha}
                onClick={() => handleViewVersion(commit.sha)}
                className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors hover:bg-accent/50 ${
                  selectedSha === commit.sha ? "bg-accent" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-muted-foreground text-[10px]">
                    {commit.sha.slice(0, 7)}
                  </span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </div>
                <p className="text-foreground truncate mt-0.5">
                  {commit.commit?.message || "No message"}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {formatDistanceToNow(new Date(commit.commit?.author?.date), { addSuffix: true })}
                </p>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Preview panel */}
      {previewContent && (
        <div className="border-t border-border shrink-0">
          <div className="px-3 py-2 flex items-center justify-between bg-muted/30">
            <span className="text-[10px] text-muted-foreground font-mono">
              {selectedSha?.slice(0, 7)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] gap-1"
              onClick={handleRestore}
              disabled={updateNote.isPending}
            >
              {updateNote.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Restore
            </Button>
          </div>
          <ScrollArea className="max-h-48">
            <pre className="p-3 text-[10px] text-muted-foreground whitespace-pre-wrap font-mono">
              {previewContent.slice(0, 2000)}
              {previewContent.length > 2000 && "…"}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
