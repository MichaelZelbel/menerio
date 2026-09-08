import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { usePeople, usePerson } from "@/hooks/usePeople";
import { usePeopleSync } from "@/hooks/usePeopleSync";
import { broadcastInvalidation } from "@/lib/query-sync";
import { topicSelectClass } from "./ContactTopicRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Search, User, ArrowRight, Loader2, UserCheck } from "lucide-react";

interface Person {
  id: string;
  name: string;
  aliases: string[];
}

interface MergePersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourcePerson: Person;
  allPeople: Person[];
  onMergeComplete: () => void;
  prefillTargetId?: string | null;
}

export function MergePersonDialog({
  open,
  onOpenChange,
  sourcePerson,
  allPeople,
  onMergeComplete,
  prefillTargetId,
}: MergePersonDialogProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { triggerPeopleSync } = usePeopleSync();
  const [search, setSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [mergeIntoSelf, setMergeIntoSelf] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [topicTarget, setTopicTarget] = useState('');
  const [topicSearch, setTopicSearch] = useState('');
  const [topicTargetName, setTopicTargetName] = useState('');
  const candidateQuery = usePeople(search, { enabled: open, excludeId: sourcePerson.id });
  const topicCandidates = usePeople(topicSearch, { enabled: open && mergeIntoSelf, excludeId: sourcePerson.id });
  const selectedQuery = usePerson(open ? selectedTarget : null);
  const topicCount = useQuery({
    queryKey: ['contact-topics', user?.id, sourcePerson.id, { count: true }],
    enabled: open && !!user, staleTime: 0, persister: undefined,
    queryFn: async ({ signal }) => {
      const { count, error } = await (supabase as SupabaseClient).from('contact_topics')
        .select('id', { count: 'exact', head: true }).eq('user_id', user!.id)
        .eq('contact_id', sourcePerson.id).abortSignal(signal);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (open && prefillTargetId) {
      setSelectedTarget(prefillTargetId);
      setMergeIntoSelf(false);
      setConfirmOpen(true);
    }
  }, [open, prefillTargetId]);

  const candidates = candidateQuery.data;
  const targetPerson = selectedQuery.data ?? candidates.find((p) => p.id === selectedTarget)
    ?? allPeople.find((p) => p.id === selectedTarget);

  const mergeMutation = useMutation({
    mutationFn: async () => {
      if (mergeIntoSelf) {
        // Recheck immediately before merging: topics can arrive from another client.
        const current = await topicCount.refetch();
        if (current.error) throw current.error;
        if (current.data) {
          if (!topicTarget) throw new Error('Choose another person for these conversation topics first.');
          const { error: moveError } = await (supabase as SupabaseClient).rpc('reassign_contact_topics', {
            p_source_contact_id: sourcePerson.id, p_target_contact_id: topicTarget,
          });
          if (moveError) throw moveError;
          const keys = [['contact-topics', user!.id], ['contact-topic-history', user!.id]];
          keys.forEach(queryKey => void qc.invalidateQueries({ queryKey }));
          broadcastInvalidation(keys);
        }
      }
      const { data, error } = await supabase.functions.invoke("merge-contacts", {
        body: {
          request_id: sourcePerson.id, // Stable across a lost response and retry.
          source_contact_id: sourcePerson.id,
          target_contact_id: mergeIntoSelf ? null : selectedTarget,
          merge_into_self: mergeIntoSelf,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const topicKeys = [['contact-topics', user!.id], ['contact-topic-history', user!.id]];
      topicKeys.forEach(queryKey => void qc.invalidateQueries({ queryKey }));
      broadcastInvalidation(topicKeys);
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact-profile-categories"] });
      qc.invalidateQueries({ queryKey: ["contact-profile-entries"] });
      qc.invalidateQueries({ queryKey: ["profile-categories"] });
      qc.invalidateQueries({ queryKey: ["profile-entries"] });
      // merge-contacts doesn't touch contact_group_memberships rows for the
      // merged-away source person — invalidate the aggregate membership
      // query (and the source's own group list) so the People tree's group
      // badges stop counting a now-merged contact as a ghost member.
      qc.invalidateQueries({ queryKey: ["contact_group_memberships"] });
      qc.invalidateQueries({ queryKey: ["person_groups"] });
      // The sweep's retire pass drops the merged person's vault file and
      // refreshes the survivor + affected group pages.
      triggerPeopleSync();
      showToast.success(
        `Merged ${sourcePerson.name} into ${mergeIntoSelf ? "your profile" : targetPerson?.name || "target"}`
      );
      onOpenChange(false);
      onMergeComplete();
    },
    onError: (err: any) => {
      showToast.error("Merge failed: " + (err.message || "Unknown error"));
    },
  });

  const handleSelectTarget = (id: string | "self") => {
    if (id === "self") {
      setSelectedTarget(null);
      setMergeIntoSelf(true);
    } else {
      setSelectedTarget(id);
      setMergeIntoSelf(false);
    }
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    mergeMutation.mutate();
  };

  const targetLabel = mergeIntoSelf ? "your profile" : targetPerson?.name || "";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Merge {sourcePerson.name}</DialogTitle>
            <DialogDescription>
              Choose who {sourcePerson.name} should be merged into. All notes, profile data, and
              mappings will be combined.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Merge into self option */}
            <button
              onClick={() => handleSelectTarget("self")}
              disabled={mergeMutation.isPending}
              className="w-full flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 shrink-0">
                <UserCheck className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Me (my own profile)</p>
                <p className="text-xs text-muted-foreground">Merge this person into your profile</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search people..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <p className="text-xs text-muted-foreground">{candidates.length} of {candidateQuery.total} people</p>
            {candidateQuery.isPending && <p role="status">Loading people...</p>}
            {candidateQuery.isError && <p role="alert">Could not load people. <button onClick={() => candidateQuery.refetch()}>Retry</button></p>}
            <div className="max-h-60 overflow-y-auto space-y-1">
              {!candidateQuery.isPending && !candidateQuery.isError && candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No other people to merge with.
                </p>
              ) : (
                candidates.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectTarget(p.id)}
                    disabled={mergeMutation.isPending}
                    className="w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      {p.aliases && p.aliases.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate">
                          aka {p.aliases.join(", ")}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))
              )}
            </div>
            {candidateQuery.hasNextPage && <Button variant="outline" disabled={candidateQuery.isFetching} onClick={() => candidateQuery.fetchNextPage()}>
              {candidateQuery.isFetchingNextPage ? "Loading..." : "Load more people"}
            </Button>}
          </div>

          {mergeMutation.isPending && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Merging...
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm merge</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                <strong>{sourcePerson.name}</strong> will be merged into{" "}
                <strong>{targetLabel}</strong>.
              </span>
              <span className="block">
                All notes, profile data, aliases, app mappings, and conversation topics will be combined into the
                target. {sourcePerson.name} will no longer appear as a separate person.
              </span>
              <span className="block text-destructive font-medium">
                This cannot be easily undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mergeIntoSelf && <div className="space-y-2 text-sm">
            {topicCount.isPending ? <p role="status">Checking conversation topics...</p> : topicCount.isError ? <p role="alert">Could not check topics. Close and try again.</p> : (topicCount.data ?? 0) > 0 ? <>
              <p>This person has {topicCount.data} conversation topics, including history. Choose another person to receive them before merging into your own profile.</p>
              <label htmlFor="merge-topic-target" className="block font-medium">Move conversation topics to</label>
              <Input aria-label="Search topic recipients" placeholder="Search all people..." value={topicSearch} onChange={e => setTopicSearch(e.target.value)} />
              <p>{topicCandidates.data.length} of {topicCandidates.total} people</p>
              {topicCandidates.isPending && <p role="status">Loading recipients...</p>}
              {topicCandidates.isError && <p role="alert">Could not load recipients. <button onClick={() => topicCandidates.refetch()}>Retry</button></p>}
              <select id="merge-topic-target" value={topicTarget} onChange={e => { setTopicTarget(e.target.value); setTopicTargetName(topicCandidates.data.find(p => p.id === e.target.value)?.name ?? ''); }} className={`${topicSelectClass} w-full`}>
                <option value="">Choose a person</option>
                {topicTarget && !topicCandidates.data.some(p => p.id === topicTarget) && <option value={topicTarget}>{topicTargetName}</option>}
                {topicCandidates.data.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
              </select>
              {topicCandidates.hasNextPage && <Button variant="outline" disabled={topicCandidates.isFetching} onClick={() => topicCandidates.fetchNextPage()}>Load more recipients</Button>}
              <p className="text-muted-foreground">Moving topics happens first and remains saved if the profile merge later fails.</p>
            </> : null}
          </div>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={mergeMutation.isPending || (mergeIntoSelf && (topicCount.isPending || topicCount.isError || ((topicCount.data ?? 0) > 0 && !topicTarget)))}>
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
