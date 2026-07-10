import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ArrowRight } from "lucide-react";

interface RecentNotesCardProps {
  notes: Array<{ id: string; title: string | null; updated_at: string }>;
}

export function RecentNotesCard({ notes }: RecentNotesCardProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Recent Notes</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/notes")} className="gap-1 text-xs">
          View All <ArrowRight className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {notes.slice(0, 5).map((note) => (
            <button
              key={note.id}
              onClick={() => navigate(`/dashboard/notes/${note.id}`)}
              className="w-full text-left flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate font-medium">{note.title || "Untitled"}</span>
              <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
                {new Date(note.updated_at).toLocaleDateString()}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
