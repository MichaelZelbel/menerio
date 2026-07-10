import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, ArrowRight } from "lucide-react";
import { useProfileSummary } from "@/hooks/useProfileSummary";

export function ProfileWidget() {
  const navigate = useNavigate();
  const profileSummary = useProfileSummary();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription className="text-sm font-medium">Profile</CardDescription>
        <User className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          {/* Mini progress ring */}
          <div className="relative shrink-0" style={{ width: 48, height: 48 }}>
            <svg width="48" height="48" viewBox="0 0 48 48">
              <circle cx="24" cy="24" r="21" fill="none" stroke="hsl(var(--muted))" strokeWidth={3} />
              <circle
                cx="24" cy="24" r="21" fill="none"
                stroke="hsl(var(--primary))" strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 21}
                strokeDashoffset={2 * Math.PI * 21 - (profileSummary.completeness / 100) * 2 * Math.PI * 21}
                transform="rotate(-90 24 24)"
                className="transition-all duration-700"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
              {profileSummary.completeness}%
            </span>
          </div>
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium">{profileSummary.entryCount} entries</p>
            <p className="text-xs text-muted-foreground">{profileSummary.activeInstructions} agent instructions</p>
          </div>
        </div>
        {profileSummary.completeness < 50 && (
          <p className="text-xs text-muted-foreground mt-2">A richer profile means better AI interactions</p>
        )}
        <Button variant="ghost" size="sm" className="mt-2 w-full gap-1 text-xs" onClick={() => navigate("/dashboard/profile")}>
          View profile <ArrowRight className="h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  );
}
