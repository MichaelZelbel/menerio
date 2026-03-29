import { useState, useMemo, useCallback } from "react";
import { Note, useUpdateNote } from "@/hooks/useNotes";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { showToast } from "@/lib/toast";
import {
  Hash,
  User,
  CheckSquare,
  LayoutGrid,
  Sparkles,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { subDays, startOfWeek, isAfter, isBefore } from "date-fns";

interface SmartTagsPanelProps {
  notes: Note[];
  onTopicClick: (topic: string) => void;
  onPersonClick: (person: string) => void;
  onTypeClick: (type: string) => void;
  onNoteSelect: (noteId: string) => void;
  activeTopicFilter: string | null;
  activeTypeFilter: string | null;
}

interface ActionItem {
  text: string;
  noteId: string;
  noteTitle: string;
  done: boolean;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  observation: "Observation",
  task: "Task",
  idea: "Idea",
  reference: "Reference",
  person_note: "Person Note",
  meeting_note: "Meeting Note",
  decision: "Decision",
  project: "Project",
};

const TYPE_COLORS: Record<string, string> = {
  observation: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  task: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  idea: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  reference: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  person_note: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  meeting_note: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  decision: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  project: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
};

export function SmartTagsPanel({
  notes,
  onTopicClick,
  onPersonClick,
  onTypeClick,
  onNoteSelect,
  activeTopicFilter,
  activeTypeFilter,
}: SmartTagsPanelProps) {
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    topics: true,
    types: true,
    people: false,
    actions: false,
    digest: false,
  });
  const updateNote = useUpdateNote();

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Extract aggregated data from all notes
  const { topicCounts, peopleCounts, typeCounts, actionItems, unclassifiedCount } = useMemo(() => {
    const topics: Record<string, number> = {};
    const people: Record<string, number> = {};
    const types: Record<string, number> = {};
    const actions: ActionItem[] = [];
    let unclassified = 0;

    for (const note of notes) {
      const meta = note.metadata as Record<string, unknown> | null;
      if (!meta || !meta.type) {
        unclassified++;
        continue;
      }

      if (Array.isArray(meta.topics)) {
        for (const t of meta.topics as string[]) {
          topics[t] = (topics[t] || 0) + 1;
        }
      }
      if (Array.isArray(meta.people)) {
        for (const p of meta.people as string[]) {
          people[p] = (people[p] || 0) + 1;
        }
      }
      if (typeof meta.type === "string") {
        types[meta.type] = (types[meta.type] || 0) + 1;
      }
      if (Array.isArray(meta.action_items)) {
        const completedItems = Array.isArray(meta.completed_actions) ? (meta.completed_actions as string[]) : [];
        for (const item of meta.action_items as string[]) {
          actions.push({
            text: item,
            noteId: note.id,
            noteTitle: note.title || "Untitled",
            done: completedItems.includes(item),
            createdAt: note.created_at,
          });
        }
      }
    }

    return {
      topicCounts: Object.entries(topics).sort((a, b) => b[1] - a[1]),
      peopleCounts: Object.entries(people).sort((a, b) => b[1] - a[1]),
      typeCounts: Object.entries(types).sort((a, b) => b[1] - a[1]),
      actionItems: actions,
      unclassifiedCount: unclassified,
    };
  }, [notes]);

  // Weekly digest
  const digest = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const lastWeekStart = subDays(weekStart, 7);
    const sevenDaysAgo = subDays(now, 7);

    let thisWeek = 0;
    let lastWeek = 0;
    const thisWeekTopics: Record<string, number> = {};
    const thisWeekPeople: Record<string, number> = {};

    for (const note of notes) {
      const created = new Date(note.created_at);
      if (isAfter(created, weekStart)) {
        thisWeek++;
        const meta = note.metadata as Record<string, unknown> | null;
        if (Array.isArray(meta?.topics)) {
          for (const t of meta.topics as string[]) {
            thisWeekTopics[t] = (thisWeekTopics[t] || 0) + 1;
          }
        }
        if (Array.isArray(meta?.people)) {
          for (const p of meta.people as string[]) {
            thisWeekPeople[p] = (thisWeekPeople[p] || 0) + 1;
          }
        }
      } else if (isAfter(created, lastWeekStart) && isBefore(created, weekStart)) {
        lastWeek++;
      }
    }

    const oldUnresolved = actionItems.filter(
      (a) => !a.done && isBefore(new Date(a.createdAt), sevenDaysAgo)
    );

    return {
      thisWeek,
      lastWeek,
      topTopics: Object.entries(thisWeekTopics).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topPeople: Object.entries(thisWeekPeople).sort((a, b) => b[1] - a[1]).slice(0, 5),
      oldUnresolved,
    };
  }, [notes, actionItems]);

  const handleBackfill = useCallback(async () => {
    setIsBackfilling(true);
    setBackfillProgress("Starting…");
    try {
      const res = await supabase.functions.invoke("backfill-metadata", { body: {} });
      if (res.error) throw res.error;
      const data = res.data as { processed: number; total: number; message: string };
      setBackfillProgress(data.message);
      showToast.success(data.message);
    } catch (err: any) {
      showToast.error(err.message || "Backfill failed");
      setBackfillProgress(null);
    } finally {
      setIsBackfilling(false);
    }
  }, []);

  const toggleActionDone = useCallback(
    async (noteId: string, actionText: string, done: boolean) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      const meta = (note.metadata || {}) as Record<string, unknown>;
      const completed = Array.isArray(meta.completed_actions) ? [...(meta.completed_actions as string[])] : [];

      if (done) {
        if (!completed.includes(actionText)) completed.push(actionText);
      } else {
        const idx = completed.indexOf(actionText);
        if (idx >= 0) completed.splice(idx, 1);
      }

      // We need to update via edge function or direct — use updateNote which handles metadata
      // Actually metadata isn't in NoteUpdate type, so we use supabase directly
      await supabase
        .from("notes" as any)
        .update({ metadata: { ...meta, completed_actions: completed } })
        .eq("id", noteId);
    },
    [notes]
  );

  const maxTopicCount = topicCounts.length > 0 ? topicCounts[0][1] : 1;

  const SectionHeader = ({ label, sectionKey, icon: Icon, badge }: { label: string; sectionKey: string; icon: any; badge?: number }) => (
    <button
      onClick={() => toggleSection(sectionKey)}
      className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
    >
      {expandedSections[sectionKey] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{badge}</span>
      )}
    </button>
  );

  return (
    <ScrollArea className="h-full">
      <div className="py-2">
        {/* Backfill button */}
        {unclassifiedCount > 0 && (
          <div className="px-3 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 text-xs h-8"
              onClick={handleBackfill}
              disabled={isBackfilling}
            >
              {isBackfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Classify all notes ({unclassifiedCount})
            </Button>
            {backfillProgress && (
              <p className="text-[10px] text-muted-foreground mt-1 text-center">{backfillProgress}</p>
            )}
          </div>
        )}

        {/* By Type */}
        <SectionHeader label="By Type" sectionKey="types" icon={LayoutGrid} badge={typeCounts.length} />
        {expandedSections.types && (
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {typeCounts.map(([type, count]) => (
              <button
                key={type}
                onClick={() => onTypeClick(type)}
                className={cn(
                  "text-[10px] px-2 py-1 rounded-full font-medium transition-all",
                  TYPE_COLORS[type] || "bg-muted text-muted-foreground",
                  activeTypeFilter === type && "ring-2 ring-primary ring-offset-1 ring-offset-background"
                )}
              >
                {TYPE_LABELS[type] || type} ({count})
              </button>
            ))}
            {typeCounts.length === 0 && (
              <p className="text-[10px] text-muted-foreground">No classified notes yet</p>
            )}
          </div>
        )}

        <Separator className="my-1" />

        {/* Topics Cloud */}
        <SectionHeader label="Topics" sectionKey="topics" icon={Hash} badge={topicCounts.length} />
        {expandedSections.topics && (
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {topicCounts.slice(0, 30).map(([topic, count]) => {
              const scale = 0.7 + (count / maxTopicCount) * 0.3;
              return (
                <button
                  key={topic}
                  onClick={() => onTopicClick(topic)}
                  className={cn(
                    "px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium transition-all hover:bg-primary/20",
                    activeTopicFilter === topic && "ring-2 ring-primary ring-offset-1 ring-offset-background bg-primary/20"
                  )}
                  style={{ fontSize: `${Math.round(scale * 11)}px` }}
                >
                  {topic}
                  <span className="ml-1 opacity-60">{count}</span>
                </button>
              );
            })}
            {topicCounts.length === 0 && (
              <p className="text-[10px] text-muted-foreground">No topics extracted yet</p>
            )}
          </div>
        )}

        <Separator className="my-1" />

        {/* People */}
        <SectionHeader label="People" sectionKey="people" icon={User} badge={peopleCounts.length} />
        {expandedSections.people && (
          <div className="px-3 pb-2 space-y-0.5">
            {peopleCounts.slice(0, 20).map(([person, count]) => (
              <button
                key={person}
                onClick={() => onPersonClick(person)}
                className="flex items-center gap-2 w-full text-left px-2 py-1 rounded-md text-xs hover:bg-accent/50 transition-colors"
              >
                <User className="h-3 w-3 text-violet-500 shrink-0" />
                <span className="flex-1 truncate">{person}</span>
                <span className="text-[10px] text-muted-foreground">{count}</span>
              </button>
            ))}
            {peopleCounts.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-2">No people mentioned yet</p>
            )}
          </div>
        )}

        <Separator className="my-1" />

        {/* Action Items */}
        <SectionHeader
          label="Action Items"
          sectionKey="actions"
          icon={CheckSquare}
          badge={actionItems.filter((a) => !a.done).length}
        />
        {expandedSections.actions && (
          <div className="px-3 pb-2 space-y-1">
            {actionItems.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-2">No action items extracted yet</p>
            )}
            {actionItems
              .sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))
              .slice(0, 30)
              .map((item, idx) => (
                <div
                  key={`${item.noteId}-${idx}`}
                  className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-accent/30 transition-colors group"
                >
                  <Checkbox
                    checked={item.done}
                    onCheckedChange={(checked) =>
                      toggleActionDone(item.noteId, item.text, Boolean(checked))
                    }
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-xs leading-tight",
                        item.done && "line-through text-muted-foreground"
                      )}
                    >
                      {item.text}
                    </p>
                    <button
                      onClick={() => onNoteSelect(item.noteId)}
                      className="text-[10px] text-muted-foreground hover:text-primary truncate block"
                    >
                      {item.noteTitle}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        <Separator className="my-1" />

        {/* Weekly Digest */}
        <SectionHeader label="Weekly Digest" sectionKey="digest" icon={TrendingUp} />
        {expandedSections.digest && (
          <div className="px-3 pb-2 space-y-2">
            {/* Notes count */}
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/30">
              <div className="flex-1">
                <p className="text-xs font-medium">{digest.thisWeek} notes this week</p>
                <p className="text-[10px] text-muted-foreground">
                  {digest.lastWeek} last week
                </p>
              </div>
              {digest.thisWeek > digest.lastWeek ? (
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              ) : digest.thisWeek < digest.lastWeek ? (
                <TrendingDown className="h-4 w-4 text-rose-500" />
              ) : (
                <Minus className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            {/* Top topics */}
            {digest.topTopics.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 px-2">Top topics</p>
                <div className="flex flex-wrap gap-1 px-2">
                  {digest.topTopics.map(([topic, count]) => (
                    <span key={topic} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                      {topic} ({count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top people */}
            {digest.topPeople.length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1 px-2">Most mentioned</p>
                <div className="flex flex-wrap gap-1 px-2">
                  {digest.topPeople.map(([person, count]) => (
                    <span key={person} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400">
                      {person} ({count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Old unresolved */}
            {digest.oldUnresolved.length > 0 && (
              <div className="px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    {digest.oldUnresolved.length} overdue action item{digest.oldUnresolved.length > 1 ? "s" : ""}
                  </p>
                </div>
                {digest.oldUnresolved.slice(0, 3).map((item, idx) => (
                  <p key={idx} className="text-[10px] text-amber-700/80 dark:text-amber-400/80 truncate">
                    • {item.text}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
