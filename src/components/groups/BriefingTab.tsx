import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { showToast } from "@/lib/toast";
import { triggerCreditsRefresh } from "@/lib/credits-events";

type GroupBriefing = Database["public"]["Tables"]["group_briefings"]["Row"];

export function BriefingTab({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const { data: briefings = [], isLoading } = useQuery<GroupBriefing[]>({
    queryKey: ["group_briefings", groupId],
    queryFn: async () => {
      const { data, error } = await supabase.from("group_briefings").select("*").eq("group_id", groupId).order("generated_at", { ascending: false }).limit(5);
      if (error) throw error;
      return data || [];
    },
  });
  const latest = briefings[0];
  const generatedToday = latest ? new Date(latest.generated_at).toDateString() === new Date().toDateString() : false;
  const generateBriefing = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ briefing_markdown: string; generated_at: string }>("generate-group-briefing", { body: { group_id: groupId, period_days: 7 } });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group_briefings", groupId] });
      triggerCreditsRefresh();
      showToast.success("Briefing generated");
    },
    onError: (error: Error) => showToast.error(error.message || "Could not generate briefing"),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Briefing</CardTitle>
          <Button onClick={() => generateBriefing.mutate()} disabled={generateBriefing.isPending || generatedToday}>
            {generateBriefing.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Generate New Briefing
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : latest ? (
          <div className="prose prose-sm max-w-none dark:prose-invert"><ReactMarkdown>{latest.briefing_markdown}</ReactMarkdown></div>
        ) : <p className="text-sm text-muted-foreground">No briefing generated yet.</p>}
      </CardContent>
    </Card>
  );
}
