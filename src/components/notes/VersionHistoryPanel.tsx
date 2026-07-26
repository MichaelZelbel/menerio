import { useState } from "react";
import { useGitHubVersionHistory, useGitHubFileAtCommit, useSyncLogForNote } from "@/hooks/useGitHubSync";
import { markdownToHtml } from "@/utils/markdown-converter";
import { useNote, useUpdateNote } from "@/hooks/useNotes";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, GitCommit, X, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { showToast } from "@/lib/toast";
import { VersionPreviewDialog } from "./VersionPreviewDialog";

interface Props {
  noteId: string;
  onClose: () => void;
}

interface CommitMeta {
  sha: string;
  date?: string | null;
  author?: string | null;
  message?: string | null;
}

export function VersionHistoryPanel({ noteId, onClose }: Props) {
  const { data: versions, isLoading } = useGitHubVersionHistory(noteId);
  const { data: syncLog } = useSyncLogForNote(noteId);
  const { data: currentNote } = useNote(noteId);
  const fetchFile = useGitHubFileAtCommit();
  const updateNote = useUpdateNote();
  const [selected, setSelected] = useState<CommitMeta | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadingSha, setLoadingSha] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ title: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVersion = async (commit: CommitMeta) => {
    if (!syncLog?.github_path) {
      showToast.error("This note isn't linked to a GitHub file yet");
      return;
    }
    setSelected(commit);
    setPreviewOpen(true);
    setParsed(null);
    setError(null);
    setLoadingSha(commit.sha);
    try {
      const content = await fetchFile.mutateAsync({ path: syncLog.github_path, commitSha: commit.sha });
      const note = markdownToNote(content);
      setParsed({ title: note.title || "Untitled", content: note.content || "" });
    } catch {
      setError("Couldn't load this version from GitHub.");
    } finally {
      setLoadingSha(null);
    }
  };

  const handleRestore = async () => {
    if (!parsed) return;
    try {
      await updateNote.mutateAsync({ id: noteId, title: parsed.title, content: parsed.content });
      showToast.success("Version restored");
      setPreviewOpen(false);
    } catch {
      showToast.error("Failed to restore version");
    }
  };

  const newestSha = versions?.[0]?.sha;

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
            {versions.map((commit: any) => {
              const meta: CommitMeta = {
                sha: commit.sha,
                date: commit.commit?.author?.date ?? null,
                author: commit.commit?.author?.name ?? null,
                message: commit.commit?.message ?? null,
              };
              return (
                <button
                  key={commit.sha}
                  onClick={() => loadVersion(meta)}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors hover:bg-accent/50 ${
                    selected?.sha === commit.sha ? "bg-accent" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-muted-foreground text-[10px]">{commit.sha.slice(0, 7)}</span>
                    <div className="flex items-center gap-1">
                      {commit.sha === newestSha && (
                        <span className="text-[9px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-px">
                          Current
                        </span>
                      )}
                      {loadingSha === commit.sha ? (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  <p className="text-foreground truncate mt-0.5">{meta.message || "No message"}</p>
                  {meta.date && (
                    <p className="text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(meta.date), { addSuffix: true })}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      )}

      <VersionPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        commitSha={selected?.sha ?? null}
        commitDate={selected?.date}
        commitAuthor={selected?.author}
        commitMessage={selected?.message}
        isLoading={!!loadingSha}
        error={error}
        onRetry={selected ? () => loadVersion(selected) : undefined}
        versionTitle={parsed?.title ?? ""}
        versionContent={parsed?.content ?? ""}
        currentTitle={currentNote?.title ?? ""}
        currentContent={currentNote?.content ?? ""}
        onRestore={handleRestore}
        isRestoring={updateNote.isPending}
      />
    </div>
  );
}
