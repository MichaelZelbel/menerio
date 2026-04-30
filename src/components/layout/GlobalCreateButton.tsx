import { useNavigate } from "react-router-dom";
import { Plus, FileText, UserPlus, ChevronDown, Sparkles, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = "https://tjeapelvjlmbxafsmjef.supabase.co";

export function GlobalCreateButton() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { data: connectedApps } = useQuery({
    queryKey: ["connected-apps-create", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("connected_apps")
        .select("app_name, webhook_url")
        .eq("user_id", user.id)
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const querinoApp = connectedApps?.find((a) => a.app_name === "querino");
  const hasIntegrations = !!querinoApp;

  const handleNewNote = () => {
    navigate("/dashboard/notes?action=create");
  };

  const handleNewQuerino = () => {
    if (!querinoApp?.webhook_url) return;
    const callbackUrl = `${SUPABASE_URL}/functions/v1/link-note`;
    const url = `${querinoApp.webhook_url}/create-from-menerio?title=&body=&entity_type=prompt&menerio_callback=${encodeURIComponent(callbackUrl)}`;
    window.open(url, "_blank");
  };

  return (
    <>
      <div className="flex items-center">
        <Button
          onClick={handleNewNote}
          size="sm"
          className="rounded-r-none gap-1.5"
        >
          <Plus className="h-4 w-4" />
          {!isMobile && <span>New Note</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleNewNote}>
              <FileText className="mr-2 h-4 w-4" />
              New Note
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/dashboard/people?action=create")}>
              <UserPlus className="mr-2 h-4 w-4" />
              New Person
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/dashboard/timeline?action=create")}>
              <Calendar className="mr-2 h-4 w-4" />
              New Moment
            </DropdownMenuItem>
            {hasIntegrations && <DropdownMenuSeparator />}
            {querinoApp && (
              <DropdownMenuItem onClick={handleNewQuerino}>
                <Sparkles className="mr-2 h-4 w-4" />
                New Prompt (Querino)
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </>
  );
}
