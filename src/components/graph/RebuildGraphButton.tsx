import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Re-syncs person profile note metadata (so person nodes get linked to every
 * note mentioning their name or aliases) and recomputes graph connections
 * with the alias-aware matcher.
 */
export function RebuildGraphButton() {
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const onClick = async () => {
    setLoading(true);
    try {
      const backfill = await supabase.functions.invoke("backfill-person-metadata", { body: {} });
      if (backfill.error) throw backfill.error;
      const updated = (backfill.data as { updated?: number })?.updated ?? 0;

      const { data: notes, error: notesErr } = await supabase
        .from("notes")
        .select("id")
        .eq("is_trashed", false)
        .limit(1000);
      if (notesErr) throw notesErr;

      let processed = 0;
      for (const n of notes || []) {
        const res = await supabase.functions.invoke("compute-connections", { body: { note_id: n.id } });
        if (!res.error) processed++;
      }

      toast.success(`Graph rebuilt`, {
        description: `${updated} person profile(s) re-synced, ${processed} note(s) recomputed.`,
      });
      qc.invalidateQueries({ queryKey: ["graph-data"] });
      qc.invalidateQueries({ queryKey: ["note-connections"] });
    } catch (e) {
      console.error(e);
      toast.error("Failed to rebuild graph", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={onClick} disabled={loading}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      Rebuild
    </Button>
  );
}
