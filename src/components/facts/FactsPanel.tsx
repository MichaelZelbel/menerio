import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Clock, History, Plus, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  changedRecently,
  formatValidityRange,
  isStale,
  humanizeAttribute,
  isCurrentClaim,
  isReservedAttribute,
  sortClaims,
  type Claim,
  type ClaimConfidence,
  type ClaimSubjectType,
} from "@/lib/claims";
import { useAddClaim, useClaims, useDeleteClaim, useEndClaim } from "@/hooks/useClaims";

interface FactsPanelProps {
  subjectType: ClaimSubjectType;
  subjectId: string | null;
  /** Shown in the empty state, e.g. "Tokyo" or the person's name. */
  subjectLabel: string;
}

const CONFIDENCE_LABELS: Record<ClaimConfidence, string> = {
  certain: "Certain",
  likely: "Likely",
  unsure: "Unsure",
};

/**
 * Dated facts for a person, a place/thing, or the user. Facts are never
 * deleted on change: ending one keeps it in History with its date range.
 * Relationship facts are excluded — the Relationships section owns those.
 */
export function FactsPanel({ subjectType, subjectId, subjectLabel }: FactsPanelProps) {
  const { data: allClaims = [], isLoading } = useClaims(subjectType, subjectId);
  const addClaim = useAddClaim();
  const endClaim = useEndClaim();
  const deleteClaim = useDeleteClaim();

  const [adding, setAdding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attribute, setAttribute] = useState("");
  const [value, setValue] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [confidence, setConfidence] = useState<ClaimConfidence>("likely");

  const claims = useMemo(
    () => allClaims.filter((c) => !isReservedAttribute(c.attribute)),
    [allClaims],
  );
  const current = useMemo(() => sortClaims(claims.filter((c) => isCurrentClaim(c))), [claims]);
  const history = useMemo(() => sortClaims(claims.filter((c) => !isCurrentClaim(c))), [claims]);
  const recent = useMemo(() => changedRecently(claims, 90), [claims]);

  const reset = () => {
    setAttribute("");
    setValue("");
    setValidFrom("");
    setConfidence("likely");
    setAdding(false);
  };

  const submit = () => {
    if (!attribute.trim() || !value.trim()) return;
    addClaim.mutate(
      {
        subject_type: subjectType,
        subject_id: subjectId,
        attribute,
        value,
        valid_from: validFrom || null,
        confidence,
      },
      { onSuccess: reset },
    );
  };

  const renderRow = (claim: Claim, superseded: boolean) => {
    const range = formatValidityRange(claim);
    return (
      <div
        key={claim.id}
        className={cn(
          "group flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2",
          superseded && "opacity-60",
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {humanizeAttribute(claim.attribute)}
            </span>
            <span className="text-sm">{claim.value}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {range && <span>{range}</span>}
            {claim.confidence !== "likely" && (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {CONFIDENCE_LABELS[claim.confidence]}
              </Badge>
            )}
            {claim.source_type === "ai" && (
              <span className="inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> AI
              </span>
            )}
            {/* The rot no contradiction check can see: one value, nothing
                disagreeing with it, quietly out of date. */}
            {!superseded && isStale(claim) && (
              <Badge
                variant="outline"
                className="border-amber-500/60 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400"
              >
                not checked since {claim.review_by}
              </Badge>
            )}
          </div>
          {claim.evidence_quote && (
            <blockquote className="mt-1 border-l-2 border-muted pl-2 text-[11px] italic text-muted-foreground">
              {claim.evidence_quote}
            </blockquote>
          )}
          {claim.source_type === "note" && claim.source_id && (
            <Link
              to={`/dashboard/notes/${claim.source_id}`}
              className="mt-0.5 inline-block text-[11px] text-primary underline underline-offset-2"
            >
              open the note this came from
            </Link>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {!superseded && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => endClaim.mutate({ id: claim.id })}
              title="Keeps the fact in history with an end date"
            >
              No longer true
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() => deleteClaim.mutate(claim.id)}
            title="Remove — use only for facts that were never true"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            Facts
            {current.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">{current.length}</span>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => setAdding((v) => !v)}>
            {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {adding ? "Cancel" : "Add fact"}
          </Button>
        </div>
        {recent.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Changed recently: {recent.length} fact{recent.length !== 1 ? "s" : ""} started or ended in
            the last 90 days
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {adding && (
          <div className="space-y-3 rounded-md border border-dashed border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="fact-attribute">What</Label>
                <Input
                  id="fact-attribute"
                  value={attribute}
                  onChange={(e) => setAttribute(e.target.value)}
                  placeholder="employer, lives-in, rent…"
                  className="h-8 text-sm"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="fact-value">Value</Label>
                <Input
                  id="fact-value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Acme"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="fact-from">Since (optional)</Label>
                <Input
                  id="fact-from"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Confidence</Label>
                <Select value={confidence} onValueChange={(v) => setConfidence(v as ClaimConfidence)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="certain">Certain</SelectItem>
                    <SelectItem value="likely">Likely</SelectItem>
                    <SelectItem value="unsure">Unsure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isReservedAttribute(attribute) && (
              <p className="text-xs text-destructive">
                Relationships are managed in the Relationships section, not here.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={reset}>Cancel</Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={
                  !attribute.trim() || !value.trim() || isReservedAttribute(attribute) || addClaim.isPending
                }
              >
                Add
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : current.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No facts recorded for {subjectLabel} yet. Facts keep their dates, so you can see what
            changed over time.
          </p>
        ) : (
          <div className="space-y-1.5">{current.map((c) => renderRow(c, false))}</div>
        )}

        {history.length > 0 && (
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
                <History className="h-3.5 w-3.5" />
                History ({history.length})
                <ChevronDown className={cn("h-3 w-3 transition-transform", historyOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1.5">
              {history.map((c) => renderRow(c, true))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
