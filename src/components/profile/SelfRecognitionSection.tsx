import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { X, Plus, UserCircle2 } from "lucide-react";
import { toast } from "sonner";

interface SelfAlias {
  id: string;
  alias: string;
  is_active: boolean;
}

export function SelfRecognitionSection() {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [newAlias, setNewAlias] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: profile } = useQuery({
    queryKey: ["profile-self", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, self_matching_enabled")
        .eq("id", userId!)
        .maybeSingle();
      return data as { display_name: string | null; self_matching_enabled: boolean } | null;
    },
  });

  const { data: aliases = [] } = useQuery({
    queryKey: ["self-aliases", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_self_aliases")
        .select("id, alias, is_active")
        .eq("user_id", userId!)
        .order("created_at");
      return (data || []) as SelfAlias[];
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("profiles")
        .update({ self_matching_enabled: enabled })
        .eq("id", userId!);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile-self", userId] }),
  });

  const addAlias = useMutation({
    mutationFn: async (alias: string) => {
      const trimmed = alias.trim();
      if (!trimmed) return;
      const { error } = await supabase
        .from("user_self_aliases")
        .insert({ user_id: userId!, alias: trimmed });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewAlias("");
      qc.invalidateQueries({ queryKey: ["self-aliases", userId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to add alias"),
  });

  const removeAlias = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_self_aliases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["self-aliases", userId] }),
  });

  const enabled = profile?.self_matching_enabled !== false;
  const firstName = profile?.display_name?.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <UserCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">When I write about myself</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              If you mention your own name in notes ("Michael's VRChat profile"), Menerio can recognize that as you and route facts to your profile instead of creating a stranger.
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => toggleEnabled.mutate(v)}
          aria-label="Enable self recognition"
        />
      </div>

      {enabled && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {firstName && (
              <Badge variant="secondary" className="gap-1">
                {firstName}
                <span className="text-[10px] opacity-60">(from name)</span>
              </Badge>
            )}
            {aliases.map((a) => (
              <Badge key={a.id} variant="outline" className="gap-1">
                {a.alias}
                <button
                  onClick={() => removeAlias.mutate(a.id)}
                  className="hover:text-destructive"
                  aria-label={`Remove ${a.alias}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add nickname or alias (e.g. Mike)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addAlias.mutate(newAlias);
              }}
              className="text-sm"
            />
            <Button size="sm" variant="outline" onClick={() => addAlias.mutate(newAlias)} disabled={!newAlias.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            When a name could refer to you or a contact (e.g. another "Michael"), we'll ask you in the Review Queue instead of guessing.
          </p>
        </>
      )}
    </div>
  );
}
