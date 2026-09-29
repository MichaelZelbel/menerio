import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useStickyPanelPreference } from "@/hooks/useStickyPanelPreference";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, X, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const NOTE_TYPES = [
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
  "meeting_note",
  "decision",
  "project",
] as const;

const SENTIMENT_EMOJI: Record<string, string> = {
  positive: "😊",
  neutral: "😐",
  negative: "😟",
  mixed: "🤔",
};

/** JSON with object keys sorted, so a value that went through jsonb (which reorders keys) still compares equal. */
function stableJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          )
        : v,
    ) ?? ""
  );
}

type Metadata = Record<string, unknown>;
type MetadataPatch = Metadata | ((current: Metadata) => Metadata);

interface PendingEdits {
  noteId: string;
  fields: Metadata;
}

interface NoteMetadataEditorProps {
  noteId: string;
  metadata: Record<string, unknown> | null;
  onUpdate: (metadata: Record<string, unknown>) => void;
  tags?: string[];
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  showTagInput?: boolean;
}

export function NoteMetadataEditor({ noteId, metadata: savedMetadata, onUpdate, tags = [], onAddTag, onRemoveTag, showTagInput }: NoteMetadataEditorProps) {
  const [topicInput, setTopicInput] = useState("");
  const [personInput, setPersonInput] = useState("");
  // Sticky global preference: remembers the user's expand/collapse choice
  // across notes and reloads. Defaults to collapsed until the user opens it.
  const [isOpen, setIsOpen] = useStickyPanelPreference("note-metadata");

  // Edits sent but not yet echoed back in `savedMetadata`, per field. The
  // saved metadata only changes after the save round trip, so merging each
  // edit onto it made the second of two quick edits (removing two topics)
  // resend the field without the first, and the first came back. Each edit
  // now merges onto these (the ref is read synchronously, so edits in a row
  // accumulate); a field leaves once the saved note carries the same value.
  const [pending, setPending] = useState<PendingEdits>({ noteId, fields: {} });
  const pendingRef = useRef<PendingEdits>(pending);
  const setPendingEdits = useCallback((next: PendingEdits) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  useEffect(() => {
    const current = pendingRef.current;
    if (current.noteId !== noteId) {
      // Another note is open: nothing carries over.
      setPendingEdits({ noteId, fields: {} });
      return;
    }
    const remaining: Metadata = {};
    let acknowledged = false;
    for (const [key, value] of Object.entries(current.fields)) {
      if (stableJson(savedMetadata?.[key]) === stableJson(value)) acknowledged = true;
      else remaining[key] = value;
    }
    if (acknowledged) setPendingEdits({ noteId, fields: remaining });
  }, [savedMetadata, noteId, setPendingEdits]);

  // What the panel shows and edits: the saved metadata with unsaved edits on top.
  const metadata = useMemo<Metadata | null>(() => {
    const own = pending.noteId === noteId ? pending.fields : {};
    return Object.keys(own).length > 0 ? { ...(savedMetadata || {}), ...own } : savedMetadata;
  }, [savedMetadata, pending, noteId]);

  const topicInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node && showTagInput) node.focus();
  }, [showTagInput]);

  // Build a lookup from person name (lowercase) -> matched contact info
  const matchedLookup = useMemo(() => {
    const map = new Map<string, { contact_id: string; canonical_name: string }>();
    const mp = Array.isArray(metadata?.matched_people)
      ? (metadata.matched_people as Array<{ name: string; contact_id: string; canonical_name: string }>)
      : [];
    for (const m of mp) {
      map.set(m.name.toLowerCase(), { contact_id: m.contact_id, canonical_name: m.canonical_name });
    }
    return map;
  }, [metadata?.matched_people]);

  const rawTopics = metadata?.topics;
  const metaTopics = useMemo(() => (Array.isArray(rawTopics) ? (rawTopics as string[]) : []), [rawTopics]);
  // Deduplicated union of metadata.topics + note.tags
  const allTopics = useMemo(() => {
    const set = new Set<string>();
    for (const t of metaTopics) set.add(t.toLowerCase());
    for (const t of tags) set.add(t.toLowerCase());
    return Array.from(set);
  }, [metaTopics, tags]);

  const people = Array.isArray(metadata?.people) ? (metadata.people as string[]) : [];
  const matchedPeople = Array.isArray(metadata?.matched_people)
    ? (metadata.matched_people as Array<{ name: string; contact_id: string; canonical_name: string }>)
    : [];
  const type = metadata?.type ? String(metadata.type) : "";
  const sentiment = metadata?.sentiment ? String(metadata.sentiment) : "";
  const summary = metadata?.summary ? String(metadata.summary) : "";
  const actionItems = Array.isArray(metadata?.action_items) ? (metadata.action_items as string[]) : [];

  const hasMetadata = !!(type || allTopics.length || people.length || summary || actionItems.length || showTagInput);

  const update = useCallback(
    (patch: MetadataPatch) => {
      const prev = pendingRef.current.noteId === noteId ? pendingRef.current.fields : {};
      const base = { ...(savedMetadata || {}), ...prev };
      const delta = typeof patch === "function" ? patch(base) : patch;
      setPendingEdits({ noteId, fields: { ...prev, ...delta } });
      onUpdate({ ...base, ...delta });
    },
    [savedMetadata, noteId, onUpdate, setPendingEdits]
  );

  const listOf = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

  const addTopic = () => {
    const t = topicInput.trim().toLowerCase();
    if (!t || allTopics.includes(t)) {
      setTopicInput("");
      return;
    }
    // Add to both metadata.topics and note.tags
    update((cur) => ({ topics: [...listOf(cur.topics), t] }));
    onAddTag?.(t);
    setTopicInput("");
  };

  const removeTopic = (topic: string) => {
    // Remove from both metadata.topics and note.tags
    update((cur) => ({ topics: listOf(cur.topics).filter((t) => t.toLowerCase() !== topic.toLowerCase()) }));
    // The chip shows the topic lowercased, but the tag is removed by exact
    // match, so pass it as stored ("Work", not "work").
    const storedTag = tags.find((t) => t.toLowerCase() === topic.toLowerCase());
    if (storedTag !== undefined) onRemoveTag?.(storedTag);
  };

  const addPerson = () => {
    const p = personInput.trim();
    if (!p || people.includes(p)) {
      setPersonInput("");
      return;
    }
    update((cur) => ({ people: [...listOf(cur.people), p] }));
    setPersonInput("");
  };

  const removePerson = (person: string) => {
    update((cur) => ({ people: listOf(cur.people).filter((p) => p !== person) }));
  };

  if (!hasMetadata) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>

      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 px-4 py-1.5 w-full text-left text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border">
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              isOpen && "rotate-90"
            )}
          />
          <Sparkles className="h-3 w-3" />
          Note Metadata
          {!isOpen && allTopics.length > 0 && (
            <span className="ml-1 text-muted-foreground/60">
              · {allTopics.slice(0, 3).map((t) => `#${t}`).join(" ")}
              {allTopics.length > 3 && ` +${allTopics.length - 3}`}
            </span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 py-2.5 border-b border-border bg-muted/20 space-y-2.5 text-xs">
          {/* Type & Sentiment row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground font-medium">Type:</span>
              <Select
                value={type}
                onValueChange={(val) => update({ type: val })}
              >
                <SelectTrigger className="h-6 w-[140px] text-xs border-border/50">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sentiment && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground font-medium">Sentiment:</span>
                <span title={sentiment}>
                  {SENTIMENT_EMOJI[sentiment] || sentiment}
                </span>
              </div>
            )}
          </div>

          {/* Topics */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-muted-foreground font-medium shrink-0">Topics:</span>
            {allTopics.map((topic) => (
              <Badge
                key={topic}
                variant="secondary"
                className="text-[10px] gap-0.5 pr-0.5 h-5"
              >
                #{topic}
                <button aria-label={`Remove topic ${topic}`}
                  onClick={() => removeTopic(topic)}
                  className="hover:text-destructive ml-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            <div className="flex items-center">
              <Input aria-label="Add topic"
                ref={topicInputRef}
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTopic();
                  }
                }}
                placeholder="add topic…"
                className="h-5 w-20 text-[10px] border-none shadow-none focus-visible:ring-0 px-1 bg-transparent"
              />
              {topicInput.trim() && (
                <Button aria-label="Add topic"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4"
                  onClick={addTopic}
                >
                  <Plus className="h-2.5 w-2.5" />
                </Button>
              )}
            </div>
          </div>

          {/* People */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-muted-foreground font-medium shrink-0">People:</span>
            {people.map((person) => {
              const matched = matchedLookup.get(person.toLowerCase());
              return (
                <Badge
                  key={person}
                  variant="outline"
                  className={cn(
                    "text-[10px] gap-0.5 pr-0.5 h-5 bg-primary/5 border-primary/20",
                    matched && "hover:bg-primary/15"
                  )}
                >
                  {matched ? (
                    <Link
                      to={`/dashboard/people/${matched.contact_id}`}
                      title={`Linked to ${matched.canonical_name}. Open their page.`}
                      className="rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      @{matched.canonical_name}
                    </Link>
                  ) : (
                    <>@{person}</>
                  )}
                  <button aria-label={`Remove ${person}`}
                    onClick={(e) => { e.stopPropagation(); removePerson(person); }}
                    className="hover:text-destructive ml-0.5"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              );
            })}
            <div className="flex items-center">
              <Input aria-label="Add person"
                value={personInput}
                onChange={(e) => setPersonInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPerson();
                  }
                }}
                placeholder="add person…"
                className="h-5 w-20 text-[10px] border-none shadow-none focus-visible:ring-0 px-1 bg-transparent"
              />
              {personInput.trim() && (
                <Button aria-label="Add person"
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4"
                  onClick={addPerson}
                >
                  <Plus className="h-2.5 w-2.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Summary */}
          {summary && (
            <div className="flex items-start gap-1.5">
              <span className="text-muted-foreground font-medium shrink-0 mt-0.5">Summary:</span>
              <p className="text-foreground/80 italic leading-relaxed">{summary}</p>
            </div>
          )}

          {/* Action Items */}
          {actionItems.length > 0 && (
            <div className="space-y-1">
              <span className="text-muted-foreground font-medium">Action items:</span>
              <ul className="space-y-0.5 ml-1">
                {actionItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-foreground/80">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
