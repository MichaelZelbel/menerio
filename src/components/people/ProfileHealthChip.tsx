import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";

type LintResult = {
  violations?: {
    relationships?: Array<{ reason: string }>;
    profile_entries?: Array<{ reason: string }>;
  };
  needs_review?: number;
  queued?: number;
};

/**
 * On-demand profile health check for one person. Runs `profile-lint` in
 * report mode (nothing is deleted), shows how many integrity violations the
 * record has, and links to the Review Queue for the cases that need a human.
 */
export function ProfileHealthChip({ contactId }: { contactId: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<LintResult | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("profile-lint", {
        body: { contact_id: contactId, repair: false, queue_review: true },
      });
      if (error) throw error;
      setResult(data as LintResult);
    } catch (err) {
      showToast.error("Could not check profile health: " + ((err as Error).message || "Unknown error"));
    } finally {
      setRunning(false);
    }
  };

  const total =
    (result?.violations?.relationships?.length ?? 0) +
    (result?.violations?.profile_entries?.length ?? 0) +
    (result?.needs_review ?? 0);

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={run} disabled={running}>
        {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
        Check profile health
      </Button>
      {result &&
        (total === 0 ? (
          <Badge variant="secondary" className="text-[10px] gap-1">
            <ShieldCheck className="h-3 w-3" /> Looks clean
          </Badge>
        ) : (
          <Link to="/dashboard/review">
            <Badge variant="outline" className="text-[10px] gap-1 cursor-pointer">
              <ShieldAlert className="h-3 w-3" /> {total} to review
            </Badge>
          </Link>
        ))}
    </div>
  );
}
