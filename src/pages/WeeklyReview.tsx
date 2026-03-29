import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SEOHead } from "@/components/SEOHead";
import { showToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Sparkles,
  TrendingUp,
  AlertCircle,
  Link2,
  HelpCircle,
  Users,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ReviewData {
  week_summary?: string;
  themes?: { name: string; note_count: number; synthesis: string }[];
  open_loops?: { action_item: string; source_note_title: string; captured_date: string; urgency: string }[];
  connections?: { note_title_1: string; note_title_2: string; connection_description: string }[];
  gaps?: string[];
  people_summary?: { name: string; interaction_count: number; latest_context: string }[];
  stats?: { total_notes: number; by_type_counts: Record<string, number>; most_active_day: string };
}

interface WeeklyReview {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  review_data: ReviewData;
  created_at: string;
}

const urgencyColors: Record<string, string> = {
  high: "bg-destructive/10 text-destructive border-destructive/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  low: "bg-muted text-muted-foreground border-border",
};

export default function WeeklyReview() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  const { data: reviews = [], isLoading } = useQuery<WeeklyReview[]>({
    queryKey: ["weekly_reviews", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_reviews" as any)
        .select("*")
        .eq("user_id", user!.id)
        .order("week_start", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data as unknown as WeeklyReview[]) || [];
    },
  });

  const generateReview = useMutation({
    mutationFn: async (days: number) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("weekly-review", {
        body: { days },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw new Error(res.error.message || "Failed to generate review");
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["weekly_reviews"] });
      if (data?.id) setSelectedReviewId(data.id);
      showToast.success("Weekly review generated!");
    },
    onError: (err: any) => {
      showToast.error(err.message || "Failed to generate review");
    },
  });

  const currentReview = selectedReviewId
    ? reviews.find((r) => r.id === selectedReviewId)
    : reviews[0];

  const review = currentReview?.review_data;
  const currentIdx = currentReview ? reviews.indexOf(currentReview) : 0;

  // Chart data from type counts
  const chartData = review?.stats?.by_type_counts
    ? Object.entries(review.stats.by_type_counts).map(([type, count]) => ({
        type: type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " "),
        count,
      }))
    : [];

  const chartColors = [
    "hsl(var(--primary))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  return (
    <div className="max-w-3xl">
      <SEOHead title="Weekly Review — Menerio" noIndex />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold">Weekly Review</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-powered analysis of your captured thoughts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            defaultValue="7"
            onValueChange={(v) => generateReview.mutate(Number(v))}
            disabled={generateReview.isPending}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Generate review" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => generateReview.mutate(7)}
            disabled={generateReview.isPending}
          >
            {generateReview.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Generate
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !currentReview ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium mb-1">No reviews yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Generate your first weekly review to see AI-powered insights about your captured thoughts.
            </p>
            <Button onClick={() => generateReview.mutate(7)} disabled={generateReview.isPending}>
              {generateReview.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Generate First Review
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Navigation between reviews */}
          {reviews.length > 1 && (
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                disabled={currentIdx >= reviews.length - 1}
                onClick={() => setSelectedReviewId(reviews[currentIdx + 1].id)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Older
              </Button>
              <span className="text-sm text-muted-foreground">
                {new Date(currentReview.week_start).toLocaleDateString()} –{" "}
                {new Date(currentReview.week_end).toLocaleDateString()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={currentIdx <= 0}
                onClick={() => setSelectedReviewId(reviews[currentIdx - 1].id)}
              >
                Newer <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* Week at a Glance */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle>Week at a Glance</CardTitle>
              </div>
              {review?.stats && (
                <div className="flex items-center gap-3 mt-2">
                  <Badge variant="secondary" className="text-xs">
                    {review.stats.total_notes} notes
                  </Badge>
                  {review.stats.most_active_day && (
                    <Badge variant="outline" className="text-xs">
                      Most active: {review.stats.most_active_day}
                    </Badge>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {review?.week_summary && (
                <p className="text-sm text-foreground leading-relaxed">{review.week_summary}</p>
              )}
              {chartData.length > 0 && (
                <div className="h-48 mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="type" className="text-xs" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {chartData.map((_, i) => (
                          <Cell key={i} fill={chartColors[i % chartColors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Themes */}
          {review?.themes && review.themes.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <CardTitle>Themes</CardTitle>
                </div>
                <CardDescription>Dominant topics from your captured thoughts</CardDescription>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  {review.themes.map((theme, i) => (
                    <AccordionItem key={i} value={`theme-${i}`}>
                      <AccordionTrigger>
                        <div className="flex items-center gap-2">
                          <span>{theme.name}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {theme.note_count} notes
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {theme.synthesis}
                        </p>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}

          {/* Open Loops */}
          {review?.open_loops && review.open_loops.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-warning" />
                  <CardTitle>Open Loops</CardTitle>
                </div>
                <CardDescription>Unresolved action items that need attention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {review.open_loops.map((loop, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border p-3 ${urgencyColors[loop.urgency] || urgencyColors.low}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{loop.action_item}</p>
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px] capitalize"
                        >
                          {loop.urgency}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        From: {loop.source_note_title} · {loop.captured_date}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Connections */}
          {review?.connections && review.connections.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-primary" />
                  <CardTitle>Connections You Missed</CardTitle>
                </div>
                <CardDescription>Non-obvious links between your notes</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {review.connections.map((conn, i) => (
                    <div key={i} className="rounded-lg border p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="text-xs">
                          {conn.note_title_1}
                        </Badge>
                        <Link2 className="h-3 w-3 text-muted-foreground" />
                        <Badge variant="outline" className="text-xs">
                          {conn.note_title_2}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{conn.connection_description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Gaps */}
          {review?.gaps && review.gaps.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Gaps</CardTitle>
                </div>
                <CardDescription>What's conspicuously absent from your notes</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {review.gaps.map((gap, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-muted-foreground/50 mt-0.5">•</span>
                      {gap}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* People */}
          {review?.people_summary && review.people_summary.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  <CardTitle>People</CardTitle>
                </div>
                <CardDescription>Who appeared in your thoughts this week</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {review.people_summary.map((person, i) => (
                    <div key={i} className="flex items-start justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">{person.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {person.latest_context}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {person.interaction_count}×
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
