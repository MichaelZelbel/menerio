import { BookOpen, Link2, Loader2, Trash2, User, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useAiFootprint,
  useRemoveAllFootprint,
  useRemoveFootprintItem,
} from "@/hooks/useAiFootprint";

interface Props {
  noteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Retroactive overview of everything an AI pipeline previously derived from
 * a note. Shown when the user hides a note from AI, so they can clean up any
 * Lexicon contributions, People profile fields and Knowledge-Graph edges
 * that the note already created.
 */
export function AiFootprintDialog({ noteId, open, onOpenChange }: Props) {
  const { data, isLoading } = useAiFootprint(noteId, open);
  const removeItem = useRemoveFootprintItem(noteId);
  const removeAll = useRemoveAllFootprint(noteId);

  const total =
    (data?.wikiPages.length ?? 0) +
    (data?.profileEntries.length ?? 0) +
    (data?.connections.length ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI footprint of this note</DialogTitle>
          <DialogDescription>
            {total === 0
              ? "This note is now hidden from AI. New pipelines will skip it."
              : "This note is now hidden from AI. New pipelines will skip it, but here is what AI already derived from it. Remove individual contributions or wipe everything at once."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…
          </div>
        ) : total === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Nothing to clean up — this note hasn’t contributed to Lexicon,
            People profiles, or the Knowledge Graph yet.
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh] pr-3">
            <div className="space-y-6">
              {data!.wikiPages.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <BookOpen className="h-4 w-4" /> Lexicon pages (
                    {data!.wikiPages.length})
                  </h3>
                  <ul className="space-y-1">
                    {data!.wikiPages.map((w) => (
                      <li
                        key={w.sourceLinkId}
                        className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <span className="truncate">{w.title}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            removeItem.mutate({ kind: "wiki", id: w.sourceLinkId })
                          }
                          disabled={removeItem.isPending}
                        >
                          <X className="mr-1 h-3 w-3" /> Unlink
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data!.profileEntries.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4" /> People profile entries (
                    {data!.profileEntries.length})
                  </h3>
                  <ul className="space-y-1">
                    {data!.profileEntries.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          <span className="text-muted-foreground">
                            {p.contactName ?? "Unknown"} ·{" "}
                          </span>
                          <span className="font-medium">{p.label}:</span>{" "}
                          {p.value}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            removeItem.mutate({ kind: "profile", id: p.id })
                          }
                          disabled={removeItem.isPending}
                        >
                          <X className="mr-1 h-3 w-3" /> Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data!.connections.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Link2 className="h-4 w-4" /> Knowledge-Graph connections (
                    {data!.connections.length})
                  </h3>
                  <ul className="space-y-1">
                    {data!.connections.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          <span className="text-muted-foreground">
                            {c.direction === "source" ? "→" : "←"}{" "}
                            {c.connectionType ?? "related"} ·{" "}
                          </span>
                          {c.otherNoteTitle ?? "Untitled note"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            removeItem.mutate({ kind: "connection", id: c.id })
                          }
                          disabled={removeItem.isPending}
                        >
                          <X className="mr-1 h-3 w-3" /> Disconnect
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={removeAll.isPending}
          >
            Keep for now
          </Button>
          {total > 0 && (
            <Button
              variant="destructive"
              onClick={() => data && removeAll.mutate(data)}
              disabled={removeAll.isPending}
            >
              {removeAll.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Remove all ({total})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
