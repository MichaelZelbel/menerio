import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
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
}

export function MergePersonDialog({
  open,
  onOpenChange,
  sourcePerson,
  allPeople,
  onMergeComplete,
}: MergePersonDialogProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [mergeIntoSelf, setMergeIntoSelf] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const candidates = allPeople
    .filter((p) => p.id !== sourcePerson.id)
    .filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.aliases || []).some((a) => a.toLowerCase().includes(q))
      );
    });

  const targetPerson = candidates.find((p) => p.id === selectedTarget);

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("merge-contacts", {
        body: {
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
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact-profile-categories"] });
      qc.invalidateQueries({ queryKey: ["contact-profile-entries"] });
      qc.invalidateQueries({ queryKey: ["profile-categories"] });
      qc.invalidateQueries({ queryKey: ["profile-entries"] });
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

            <div className="max-h-60 overflow-y-auto space-y-1">
              {candidates.length === 0 ? (
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
                All notes, profile data, aliases, and app mappings will be combined into the
                target. {sourcePerson.name} will no longer appear as a separate person.
              </span>
              <span className="block text-destructive font-medium">
                This cannot be easily undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
