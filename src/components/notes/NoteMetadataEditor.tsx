import { useState, useCallback } from "react";
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

interface NoteMetadataEditorProps {
  metadata: Record<string, unknown> | null;
  onUpdate: (metadata: Record<string, unknown>) => void;
}

export function NoteMetadataEditor({ metadata, onUpdate }: NoteMetadataEditorProps) {
  const [topicInput, setTopicInput] = useState("");
  const [personInput, setPersonInput] = useState("");
  const [isOpen, setIsOpen] = useState(!!metadata?.type);

  const topics = Array.isArray(metadata?.topics) ? (metadata.topics as string[]) : [];
  const people = Array.isArray(metadata?.people) ? (metadata.people as string[]) : [];
  const type = metadata?.type ? String(metadata.type) : "";
  const sentiment = metadata?.sentiment ? String(metadata.sentiment) : "";
  const summary = metadata?.summary ? String(metadata.summary) : "";
  const actionItems = Array.isArray(metadata?.action_items) ? (metadata.action_items as string[]) : [];

  const hasMetadata = !!(type || topics.length || people.length || summary || actionItems.length);

  const update = useCallback(
    (patch: Record<string, unknown>) => {
      onUpdate({ ...(metadata || {}), ...patch });
    },
    [metadata, onUpdate]
  );

  const addTopic = () => {
    const t = topicInput.trim().toLowerCase();
    if (!t || topics.includes(t)) {
      setTopicInput("");
      return;
    }
    update({ topics: [...topics, t] });
    setTopicInput("");
  };

  const removeTopic = (topic: string) => {
    update({ topics: topics.filter((t) => t !== topic) });
  };

  const addPerson = () => {
    const p = personInput.trim();
    if (!p || people.includes(p)) {
      setPersonInput("");
      return;
    }
    update({ people: [...people, p] });
    setPersonInput("");
  };

  const removePerson = (person: string) => {
    update({ people: people.filter((p) => p !== person) });
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
          Smart Tags
          {!isOpen && topics.length > 0 && (
            <span className="ml-1 text-muted-foreground/60">
              · {topics.slice(0, 3).map((t) => `#${t}`).join(" ")}
              {topics.length > 3 && ` +${topics.length - 3}`}
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
            {topics.map((topic) => (
              <Badge
                key={topic}
                variant="secondary"
                className="text-[10px] gap-0.5 pr-0.5 h-5"
              >
                #{topic}
                <button
                  onClick={() => removeTopic(topic)}
                  className="hover:text-destructive ml-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            <div className="flex items-center">
              <Input
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
                <Button
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
            {people.map((person) => (
              <Badge
                key={person}
                variant="outline"
                className="text-[10px] gap-0.5 pr-0.5 h-5 bg-primary/5 border-primary/20"
              >
                @{person}
                <button
                  onClick={() => removePerson(person)}
                  className="hover:text-destructive ml-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            <div className="flex items-center">
              <Input
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
                <Button
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
