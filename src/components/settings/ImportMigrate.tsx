import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Loader2, Brain, FileText, Upload, Copy, Check, Sparkles } from "lucide-react";

const AI_MEMORY_PROMPT = `I'm setting up a personal knowledge system called Menerio. Please check your memory and conversation history for everything you know about me — my role, projects, preferences, key people, decisions, and recurring topics. Organize it into categories: People, Projects, Preferences, Decisions, Professional context, Personal context. Present each item as a clear standalone statement. I'll save these to my system.`;

interface ImportResult {
  total: number;
  processed: number;
  failed: number;
  types: Record<string, number>;
}

function splitIntoItems(text: string): string[] {
  return text
    .split(/\n/)
    .map((line) => line.replace(/^[\s•\-\*\d+\.]+/, "").trim())
    .filter((line) => line.length > 5);
}

function splitByHeadings(markdown: string): { title: string; content: string }[] {
  const sections: { title: string; content: string }[] = [];
  const parts = markdown.split(/^##\s+/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const newline = trimmed.indexOf("\n");
    if (newline === -1) {
      sections.push({ title: trimmed.slice(0, 80), content: trimmed });
    } else {
      sections.push({
        title: trimmed.slice(0, newline).trim().slice(0, 80),
        content: trimmed.slice(newline + 1).trim(),
      });
    }
  }
  return sections.length ? sections : [{ title: markdown.slice(0, 50), content: markdown }];
}

function splitByParagraphs(text: string): { title: string; content: string }[] {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 10);
  return blocks.map((b) => {
    const firstLine = b.split("\n")[0].replace(/^#+\s*/, "").trim();
    return {
      title: firstLine.slice(0, 80),
      content: b,
    };
  });
}

export function ImportMigrate() {
  const { user } = useAuth();
  const { toast } = useToast();

  // AI Memory import
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Notion import
  const [notionText, setNotionText] = useState("");
  const [notionLoading, setNotionLoading] = useState(false);
  const [notionResult, setNotionResult] = useState<ImportResult | null>(null);

  // File import
  const [fileLoading, setFileLoading] = useState(false);
  const [fileResult, setFileResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Progress
  const [progress, setProgress] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(AI_MEMORY_PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  async function importItems(
    items: { title: string; content: string }[],
    source: string,
    setLoading: (v: boolean) => void,
    setResult: (v: ImportResult) => void
  ) {
    if (!user || items.length === 0) return;
    setLoading(true);
    setProgress(0);
    setProgressTotal(items.length);

    const result: ImportResult = { total: items.length, processed: 0, failed: 0, types: {} };
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ variant: "destructive", title: "Not authenticated" });
      setLoading(false);
      return;
    }

    // Process in batches of 3
    for (let i = 0; i < items.length; i += 3) {
      const batch = items.slice(i, i + 3);
      const promises = batch.map(async (item) => {
        try {
          const res = await supabase.functions.invoke("quick-capture", {
            body: { content: item.content, source },
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.error || res.data?.error) {
            result.failed++;
          } else {
            result.processed++;
            const type = res.data?.metadata?.type || "unknown";
            result.types[type] = (result.types[type] || 0) + 1;
          }
        } catch {
          result.failed++;
        }
      });
      await Promise.all(promises);
      setProgress(Math.min(i + batch.length, items.length));
    }

    setResult(result);
    setLoading(false);
    toast({
      title: "Import complete",
      description: `Imported ${result.processed} of ${result.total} items.`,
    });
  }

  const handleAiImport = () => {
    const items = splitIntoItems(aiText).map((line) => ({
      title: line.slice(0, 80),
      content: line,
    }));
    importItems(items, "ai_memory_migration", setAiLoading, setAiResult);
  };

  const handleNotionImport = () => {
    const items = splitByHeadings(notionText);
    importItems(items, "notion_import", setNotionLoading, setNotionResult);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
      toast({ variant: "destructive", title: "Invalid file", description: "Only .txt and .md files are supported." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "destructive", title: "File too large", description: "Maximum 5MB." });
      return;
    }
    const text = await file.text();
    const items = splitByParagraphs(text);
    importItems(items, "file_import", setFileLoading, setFileResult);
  };

  const isProcessing = aiLoading || notionLoading || fileLoading;
  const currentProgress = progressTotal > 0 ? (progress / progressTotal) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Import & Migrate
        </CardTitle>
        <CardDescription>
          Bring your existing knowledge into Menerio. Each item gets AI-powered embedding and metadata extraction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isProcessing && (
          <div className="mb-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Processing…</span>
              <span className="text-foreground font-medium">{progress} / {progressTotal}</span>
            </div>
            <Progress value={currentProgress} className="h-2" />
          </div>
        )}

        <Tabs defaultValue="ai-memory" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ai-memory" className="gap-1.5 text-xs">
              <Brain className="h-3.5 w-3.5" /> AI Memory
            </TabsTrigger>
            <TabsTrigger value="notion" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" /> Notion
            </TabsTrigger>
            <TabsTrigger value="file" className="gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" /> File
            </TabsTrigger>
          </TabsList>

          {/* AI Memory Import */}
          <TabsContent value="ai-memory" className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Step 1: Copy this prompt into Claude or ChatGPT</p>
              <div className="relative">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-background rounded-md p-3 border">
                  {AI_MEMORY_PROMPT}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute top-2 right-2 h-7 gap-1"
                  onClick={copyPrompt}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Step 2: Paste the AI's response here</p>
              <Textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                placeholder="Paste the response from Claude or ChatGPT here…"
                rows={8}
                disabled={aiLoading}
              />
              <p className="text-xs text-muted-foreground">
                {splitIntoItems(aiText).length} items detected
              </p>
            </div>

            <Button onClick={handleAiImport} disabled={aiLoading || !aiText.trim()}>
              {aiLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Process & Import
            </Button>

            {aiResult && <ImportSummary result={aiResult} />}
          </TabsContent>

          {/* Notion Import */}
          <TabsContent value="notion" className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                Export your Notion page as Markdown, then paste it below. Notes will be split by <code className="bg-background px-1 rounded text-xs">##</code> headings.
              </p>
            </div>

            <Textarea
              value={notionText}
              onChange={(e) => setNotionText(e.target.value)}
              placeholder="Paste your Notion markdown export here…"
              rows={8}
              disabled={notionLoading}
            />
            <p className="text-xs text-muted-foreground">
              {notionText ? splitByHeadings(notionText).length : 0} sections detected
            </p>

            <Button onClick={handleNotionImport} disabled={notionLoading || !notionText.trim()}>
              {notionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import from Notion
            </Button>

            {notionResult && <ImportSummary result={notionResult} />}
          </TabsContent>

          {/* File Import */}
          <TabsContent value="file" className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">
                Upload a <code className="bg-background px-1 rounded text-xs">.txt</code> or{" "}
                <code className="bg-background px-1 rounded text-xs">.md</code> file. Notes will be split by double newlines or headings. Max 5MB.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={fileLoading}
              >
                {fileLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Choose File
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>

            {fileResult && <ImportSummary result={fileResult} />}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
      <p className="text-sm font-medium text-foreground">
        Import Summary
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{result.processed} imported</Badge>
        {result.failed > 0 && <Badge variant="destructive">{result.failed} failed</Badge>}
      </div>
      {Object.keys(result.types).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {Object.entries(result.types).map(([type, count]) => (
            <Badge key={type} variant="outline" className="text-xs">
              {type}: {count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
