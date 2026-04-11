import { useNavigate } from "react-router-dom";
import { Plus, FileText, UserPlus, ChevronDown, Sparkles, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";

export function GlobalCreateButton() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const handleNewNote = () => {
    navigate("/dashboard/notes?action=create");
  };

  return (
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
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="opacity-50">
            <Sparkles className="mr-2 h-4 w-4" />
            New Prompt (Quereno)
          </DropdownMenuItem>
          <DropdownMenuItem disabled className="opacity-50">
            <CalendarPlus className="mr-2 h-4 w-4" />
            New Event (Temerio)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
