import { useState } from "react";
import { Note, RelatedItem } from "@/hooks/useNotes";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink,
  Pencil,
  Check,
  X,
  Loader2,
  AlertTriangle,
  User,
  Calendar,
  Lightbulb,
  FileText,
  Link2,
} from "lucide-react";

const SYNC_COLORS: Record<string, string> = {
  synced: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-400",
};

const RELATED_ICONS: Record<string, typeof User> = {
  person: User,
  event: Calendar,
  idea: Lightbulb,
  document: FileText,
};

interface ExternalNotePanelProps {
  note: Note;
}

export function ExternalNotePanel({ note }: ExternalNotePanelProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [patchingField, setPatchingField] = useState<string | null>(null);

  const fields = note.structured_fields || {};
  const related = (note.related || []) as RelatedItem[];
  const rejectReason = fields._last_reject_reason as string | undefined;

  const handleEditStart = (key: string) => {
    setEditingField(key);
    setEditValue(String(fields[key] ?? ""));
  };

  const handleEditCancel = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleEditSave = async (key: string) => {
    setPatchingField(key);
    setEditingField(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-patch", {
        body: {
          note_id: note.id,
          field_changes: { [key]: editValue },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      showToast.success(data.message || "Patch sent");
    } catch (err: any) {
      showToast.error(err.message || "Failed to send patch");
    } finally {
      setPatchingField(null);
    }
  };

  const displayFields = Object.entries(fields).filter(
    ([k]) => !k.startsWith("_")
  );

  return (
    <div className="space-y-4">
      {/* Source app header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Daten aus {note.source_app}
          </h3>
          <Badge
            variant="outline"
            className={SYNC_COLORS[note.sync_status] || ""}
          >
            {note.sync_status === "pending" && (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            )}
            {note.sync_status === "rejected" && (
              <AlertTriangle className="h-3 w-3 mr-1" />
            )}
            {note.sync_status}
          </Badge>
        </div>
        {note.source_url && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => window.open(note.source_url!, "_blank")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            In {note.source_app} öffnen
          </Button>
        )}
      </div>

      {/* Reject reason */}
      {note.sync_status === "rejected" && rejectReason && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <strong>Abgelehnt:</strong> {rejectReason}
        </div>
      )}

      {/* Structured fields */}
      {displayFields.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          {displayFields.map(([key, value], i) => {
            const isEditing = editingField === key;
            const isPatching = patchingField === key;

            return (
              <div
                key={key}
                className={`flex items-center gap-3 px-3 py-2 text-sm ${
                  i < displayFields.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <span className="text-muted-foreground font-medium min-w-[120px] text-xs">
                  {key}
                </span>
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="h-7 text-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEditSave(key);
                        if (e.key === "Escape") handleEditCancel();
                      }}
                    />
                  ) : (
                    <span className="text-xs text-foreground truncate block">
                      {String(value)}
                    </span>
                  )}
                </div>
                <div className="shrink-0">
                  {isPatching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                  ) : isEditing ? (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleEditSave(key)}
                      >
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={handleEditCancel}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => handleEditStart(key)}
                    >
                      <Pencil className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Related items */}
      {related.length > 0 && (
        <>
          <Separator />
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Verknüpfungen
            </h4>
            <div className="space-y-1.5">
              {related.map((item, i) => {
                const Icon = RELATED_ICONS[item.type] || Link2;
                return (
                  <button
                    key={i}
                    className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-accent/50 transition-colors text-left"
                    onClick={() => {
                      if (item.source_url) {
                        window.open(item.source_url, "_blank");
                      }
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate text-foreground font-medium">
                      {item.name}
                    </span>
                    {item.date && (
                      <span className="text-muted-foreground text-[10px]">
                        {item.date}
                      </span>
                    )}
                    {item.source_app && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-400">
                        {item.source_app}
                      </span>
                    )}
                    {item.source_url && (
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
