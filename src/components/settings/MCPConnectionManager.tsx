import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Copy,
  Check,
  Terminal,
  Monitor,
  Code2,
  Sparkles,
  Eye,
  EyeOff,
  Key,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

const MCP_URL = "https://mcp.menerio.com";

const TOOLS = [
  { name: "search_thoughts", desc: "Semantic search across all your captured thoughts by meaning" },
  { name: "list_recent", desc: "List recent notes with filters by type, topic, person, or date range" },
  { name: "capture_thought", desc: "Save a new thought — auto-generates embedding and metadata" },
  { name: "get_stats", desc: "Summary statistics: totals, top topics, people, recent activity" },
  { name: "get_action_items", desc: "All open action items extracted from notes" },
  { name: "get_person_notes", desc: "All notes mentioning a specific person" },
  { name: "search_images", desc: "Search across all analyzed images and PDFs by description or extracted text" },
  { name: "get_note_media", desc: "Get all media analysis results for a specific note" },
  { name: "get_user_profile", desc: "Retrieve identity, preferences, values, goals, and agent instructions" },
];

function formatExpiry(expiresAtSeconds: number | undefined): string {
  if (!expiresAtSeconds) return "—";
  const ms = expiresAtSeconds * 1000 - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function MCPConnectionManager() {
  const { session } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [, forceTick] = useState(0);

  const accessToken = session?.access_token ?? "";
  const expiresAt = session?.expires_at;

  // Tick every 30s so the "valid for" countdown stays fresh
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyButton = ({ text, id, label }: { text: string; id: string; label?: string }) => (
    <Button
      variant="outline"
      size={label ? "sm" : "icon"}
      className="shrink-0"
      onClick={() => handleCopy(text, id)}
    >
      {copied === id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      {label && <span className="ml-1.5">{label}</span>}
    </Button>
  );

  const tokenOrPlaceholder = accessToken || "YOUR_ACCESS_TOKEN";
  const maskedToken = accessToken
    ? `${accessToken.slice(0, 12)}${"•".repeat(24)}${accessToken.slice(-6)}`
    : "";

  const claudeSnippet = useMemo(
    () => `{
  "mcpServers": {
    "menerio": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${MCP_URL}",
        "--header",
        "Authorization: Bearer ${tokenOrPlaceholder}"
      ]
    }
  }
}`,
    [tokenOrPlaceholder]
  );

  const claudeCodeCommand = useMemo(
    () =>
      `claude mcp add --transport http menerio ${MCP_URL} --header "Authorization: Bearer ${tokenOrPlaceholder}"`,
    [tokenOrPlaceholder]
  );

  const agentPrompt = useMemo(
    () => `You have access to Menerio — the user's personal AI memory and second brain.

# Connection
- MCP Server URL: ${MCP_URL}
- Auth header: \`Authorization: Bearer <token>\`
- The user pastes a fresh token (valid ~1 hour). When it expires, ask the user for a new one from Menerio → Settings → MCP.

# What Menerio is
Menerio stores the user's thoughts, notes, contacts (People), action items, media (images/PDFs with AI descriptions), a knowledge graph of links between notes, and a structured profile (identity, preferences, values, goals, agent instructions).

# Available tools
- \`search_thoughts(query, limit?, threshold?)\` — semantic search across notes. Use first when the user asks about a topic, idea, or anything they've previously captured.
- \`list_recent(limit?, type?, topic?, person?, days?)\` — recent notes, filterable.
- \`capture_thought(content)\` — save a new thought. Title, embedding, topics, people and action items are extracted automatically.
- \`get_stats()\` — totals, top topics, people, recent activity.
- \`get_action_items(status?, priority?, person?, include_done?)\` — open to-dos extracted from notes.
- \`get_person_notes(name)\` — all notes mentioning a specific person.
- \`search_images(query)\` — search analyzed images and PDFs by description or extracted text.
- \`get_note_media(note_id)\` — media analysis attached to a note.
- \`get_user_profile(include_instructions?, include_notes?, scope?)\` — identity, preferences, values, goals, agent instructions. Call this once at the start of a session so you know who the user is.

# How to behave
- On first use in a conversation, call \`get_user_profile\` so your answers are personalised. Honour any \`agent_instructions\` returned.
- When the user references something they "remember", "wrote down", "captured", or asks "what do I know about X", call \`search_thoughts\` before answering from memory.
- When the user shares a new fact, decision, idea, observation, or meeting note worth keeping, call \`capture_thought\` — don't ask for permission for short factual captures, do confirm for long-form content.
- Output style: concise. For lists of notes, show one bullet per item with title + date. Only show full content when explicitly asked.
- After any \`capture_thought\`, end with a one-line confirmation including the detected type and topics.
- Never invent note ids, titles, or dates. If a search returns nothing, say so.
- If a tool call returns "Invalid or expired session token", tell the user to grab a fresh token from Menerio → Settings → MCP and paste it.

Use these tools whenever the user asks you to recall, search, save, or organise anything from their personal memory.`,
    []
  );

  return (
    <div className="space-y-6">
      {/* Profile tip */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start gap-2.5 text-sm">
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Tip:</span> Make sure your{" "}
          <a href="/dashboard/profile" className="underline text-primary hover:text-primary/80">
            profile
          </a>{" "}
          is filled in so your AI tool can understand who you are. The more context it has, the better it works.
        </p>
      </div>

      {/* Access Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" /> Your Access Token
          </CardTitle>
          <CardDescription>
            Paste this into your AI agent to connect it to your Menerio brain. The token is tied to your current
            login and refreshes automatically while you're signed in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!accessToken ? (
            <p className="text-sm text-muted-foreground">
              You need to be signed in to see your access token.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                  {showToken ? accessToken : maskedToken}
                </code>
                <Button variant="ghost" size="icon" onClick={() => setShowToken((s) => !s)}>
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <CopyButton text={accessToken} id="token" />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <Badge variant="outline" className="gap-1.5">
                  <Clock className="h-3 w-3" />
                  Valid for ~{formatExpiry(expiresAt)}
                </Badge>
                <span>
                  Refreshes automatically while you're signed in. Just come back here for a new one when your
                  agent needs it.
                </span>
              </div>
            </>
          )}

          <div className="space-y-2 pt-2 border-t">
            <p className="text-sm font-medium">MCP Server URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                {MCP_URL}
              </code>
              <CopyButton text={MCP_URL} id="url" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Agent Setup Prompt
          </CardTitle>
          <CardDescription>
            Paste this into your AI agent's system prompt or instructions. It tells the agent what Menerio is, which
            tools are available, and how to use them well.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            readOnly
            value={agentPrompt}
            className="min-h-[280px] font-mono text-xs leading-relaxed"
          />
          <div className="flex justify-end">
            <CopyButton text={agentPrompt} id="prompt" label="Copy prompt" />
          </div>
        </CardContent>
      </Card>

      {/* Available Tools */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Available Tools
          </CardTitle>
          <CardDescription>
            These tools are exposed to any AI agent connected to your MCP server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {TOOLS.map((tool) => (
              <div key={tool.name} className="flex items-start gap-3 rounded-lg border p-3">
                <Badge variant="outline" className="mt-0.5 font-mono text-[10px] shrink-0">
                  {tool.name}
                </Badge>
                <p className="text-sm text-muted-foreground">{tool.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Connection Guides */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" /> Compatible Clients
          </CardTitle>
          <CardDescription>
            Copy-paste configs for popular MCP-compatible AI tools. Replace the token whenever you need a fresh
            one — just come back to this page and copy it again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="claude">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  <span>Claude Desktop</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Open Claude Desktop</li>
                  <li>
                    Go to <strong>Settings</strong> → <strong>Developer</strong> → <strong>Edit Config</strong>
                  </li>
                  <li>Paste the JSON below into <code className="text-xs">claude_desktop_config.json</code></li>
                  <li>Restart Claude Desktop</li>
                </ol>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">{claudeSnippet}</pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={claudeSnippet} id="claude" />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="claude-code">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  <span>Claude Code (CLI)</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Run this in your terminal:</p>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto break-all">
                    {claudeCodeCommand}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={claudeCodeCommand} id="claude-code" />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="cursor">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4" />
                  <span>Cursor / VS Code</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Add this to <code className="text-xs bg-muted px-1 rounded">.cursor/mcp.json</code> or your VS
                  Code MCP settings:
                </p>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">{claudeSnippet}</pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={claudeSnippet} id="cursor" />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="other">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  <span>Any other MCP client</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm text-muted-foreground">
                <p>Menerio speaks the standard MCP Streamable HTTP protocol. For any client:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Endpoint: <code className="text-xs bg-muted px-1 rounded">{MCP_URL}</code>
                  </li>
                  <li>
                    Header: <code className="text-xs bg-muted px-1 rounded">Authorization: Bearer &lt;token&gt;</code>
                  </li>
                  <li>Transport: HTTP (Streamable)</li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
