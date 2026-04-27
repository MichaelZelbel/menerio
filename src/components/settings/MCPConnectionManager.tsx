import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Key,
  Plus,
  Loader2,
  AlertTriangle,
  ShieldOff,
} from "lucide-react";
import { toast } from "sonner";

const MCP_URL = "https://mcp.menerio.com";
const MCP_TOKEN_PREFIX = "mnr_mcp_";
const TOKEN_PLACEHOLDER = `${MCP_TOKEN_PREFIX}YOUR_TOKEN`;

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
  { name: "wiki_search", desc: "Search wiki pages by title, slug, or content" },
  { name: "wiki_get_page", desc: "Read a full wiki page with sources and backlinks" },
  { name: "wiki_create_page", desc: "Create a reviewed wiki page on your behalf" },
  { name: "wiki_update_page", desc: "Update a reviewed wiki page on your behalf" },
  { name: "wiki_run_lint", desc: "Run the wiki health check for broken links, orphans, drift, and contradictions" },
];

type McpApiToken = {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

const EXPIRATION_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "365 days" },
];

function base64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function generateMcpToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${MCP_TOKEN_PREFIX}${base64Url(bytes)}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function getTokenStatus(token: McpApiToken) {
  if (token.revoked_at) return { label: "Revoked", variant: "destructive" as const };
  if (token.expires_at && new Date(token.expires_at) <= new Date()) {
    return { label: "Expired", variant: "secondary" as const };
  }
  return { label: "Active", variant: "outline" as const };
}

export function MCPConnectionManager() {
  const { session } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const [tokens, setTokens] = useState<McpApiToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [expiration, setExpiration] = useState("never");
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  const userId = session?.user?.id;

  const fetchTokens = async () => {
    if (!userId) {
      setTokens([]);
      setLoadingTokens(false);
      return;
    }

    setLoadingTokens(true);
    const { data, error } = await supabase
      .from("mcp_api_tokens" as never)
      .select("id, name, token_prefix, created_at, last_used_at, expires_at, revoked_at")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load MCP tokens");
    } else {
      setTokens((data || []) as unknown as McpApiToken[]);
    }
    setLoadingTokens(false);
  };

  useEffect(() => {
    fetchTokens();
  }, [userId]);

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  };

  const resetCreateDialog = () => {
    setNewTokenName("");
    setExpiration("never");
    setCreating(false);
  };

  const handleCreateToken = async () => {
    if (!userId || !newTokenName.trim()) return;

    setCreating(true);
    const rawToken = generateMcpToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = expiration === "never"
      ? null
      : new Date(Date.now() + Number(expiration) * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from("mcp_api_tokens" as never).insert({
      user_id: userId,
      name: newTokenName.trim().slice(0, 80),
      token_hash: tokenHash,
      token_prefix: rawToken.slice(0, 16),
      expires_at: expiresAt,
    } as never);

    setCreating(false);

    if (error) {
      toast.error("Failed to create MCP token");
      return;
    }

    setCreateOpen(false);
    resetCreateDialog();
    setRevealedToken(rawToken);
    toast.success("Personal MCP Token created");
    fetchTokens();
  };

  const handleRevoke = async (tokenId: string) => {
    const { error } = await supabase
      .from("mcp_api_tokens" as never)
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq("id", tokenId);

    if (error) {
      toast.error("Failed to revoke MCP token");
      return;
    }

    toast.success("MCP token revoked");
    fetchTokens();
  };

  const CopyButton = ({ text, id, label }: { text: string; id: string; label?: string }) => (
    <Button
      variant="outline"
      size={label ? "sm" : "icon"}
      className="shrink-0"
      onClick={() => handleCopy(text, id)}
    >
      {copied === id ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
      {label && <span className="ml-1.5">{label}</span>}
    </Button>
  );

  const claudeSnippet = useMemo(
    () => `{
  "mcpServers": {
    "menerio": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${MCP_URL}",
        "--header",
        "Authorization: Bearer ${TOKEN_PLACEHOLDER}",
        "--header",
        "Accept: application/json, text/event-stream",
        "--header",
        "Content-Type: application/json"
      ]
    }
  }
}`,
    []
  );

  const claudeCodeCommand = useMemo(
    () =>
      `claude mcp add --transport http menerio ${MCP_URL} --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}" --header "Accept: application/json, text/event-stream" --header "Content-Type: application/json"`,
    []
  );

  const agentPrompt = useMemo(
    () => `You have access to Menerio — the user's personal AI memory and second brain.

# Connection
- MCP Server URL: ${MCP_URL}
- Auth header: \`Authorization: Bearer <PROJECT_MCP_TOKEN>\`
- Token format: the token starts with \`${MCP_TOKEN_PREFIX}\`.
- The token is long-lived. It does not expire after 1 hour; it remains valid until the user revokes it or until its optional expiration date.
- Required headers:
  - \`Authorization: Bearer <PROJECT_MCP_TOKEN>\`
  - \`Accept: application/json, text/event-stream\`
  - \`Content-Type: application/json\`
- Keep the endpoint exactly as shown above. Do not add /mcp, /sse, /v1, or any other path.
- Verification flow: call \`initialize\`, then \`tools/list\`, then \`tools/call\` with the safe read-only tool \`get_user_profile\`.
- If a tool call returns \`401 Invalid or revoked token\`, ask the user for a new Personal MCP Token from Menerio → Settings → MCP Server instead of retrying.

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
- \`wiki_search(query, limit?, page_type?)\` — search wiki pages by title, slug, or content.
- \`wiki_get_page(slug)\` — read a full wiki page with source notes and backlinks.
- \`wiki_create_page(slug, title, page_type, content, summary?)\` — create a reviewed wiki page on the user's behalf.
- \`wiki_update_page(slug, content?, title?, summary?, page_type?)\` — update a reviewed wiki page on the user's behalf.
- \`wiki_run_lint()\` — run the wiki health check.

# How to behave
- On first use in a conversation, call \`get_user_profile\` so your answers are personalised. Honour any \`agent_instructions\` returned.
- When the user references something they "remember", "wrote down", "captured", or asks "what do I know about X", call \`search_thoughts\` before answering from memory.
- When the user asks about durable synthesized knowledge, concepts, projects, people, or a wiki page, use \`wiki_search\` or \`wiki_get_page\`.
- When the user shares a new fact, decision, idea, observation, or meeting note worth keeping, call \`capture_thought\` — don't ask for permission for short factual captures, do confirm for long-form content.
- Output style: concise. For lists of notes, show one bullet per item with title + date. Only show full content when explicitly asked.
- After any \`capture_thought\`, end with a one-line confirmation including the detected type and topics.
- Never invent note ids, titles, or dates. If a search returns nothing, say so.

Use these tools whenever the user asks you to recall, search, save, or organise anything from their personal memory.`,
    []
  );

  return (
    <div className="space-y-6">
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

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" /> Personal MCP Tokens
              </CardTitle>
              <CardDescription>
                Long-lived, revocable tokens for Claude Desktop, Cursor, OpenClaw, Manus, n8n, and other MCP clients.
              </CardDescription>
            </div>
            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (!open) resetCreateDialog();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" disabled={!userId}>
                  <Plus className="mr-2 h-4 w-4" /> Create token
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Personal MCP Token</DialogTitle>
                  <DialogDescription>
                    Choose a label and optional expiration. The full token is shown only once after creation.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="mcp-token-name">Name</Label>
                    <Input
                      id="mcp-token-name"
                      value={newTokenName}
                      onChange={(event) => setNewTokenName(event.target.value.slice(0, 80))}
                      maxLength={80}
                      placeholder="Claude Desktop on MacBook"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Expiration</Label>
                    <Select value={expiration} onValueChange={setExpiration}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRATION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateToken} disabled={creating || !newTokenName.trim()}>
                    {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create token
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">MCP Server URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                {MCP_URL}
              </code>
              <CopyButton text={MCP_URL} id="url" />
            </div>
          </div>

          {loadingTokens ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-md border p-4 text-center">
              No Personal MCP Tokens yet. Create one to connect an external MCP client.
            </p>
          ) : (
            <div className="space-y-3">
              {tokens.map((token) => {
                const status = getTokenStatus(token);
                const disabled = Boolean(token.revoked_at);
                return (
                  <div key={token.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{token.name}</span>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      <code className="block text-xs text-muted-foreground font-mono break-all">
                        {token.token_prefix}…
                      </code>
                      <p className="text-xs text-muted-foreground">
                        Created {formatDate(token.created_at)} · Last used {formatDate(token.last_used_at)} · Expires {formatDate(token.expires_at)}
                      </p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" disabled={disabled} className="shrink-0">
                          <ShieldOff className="mr-2 h-4 w-4" /> Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke MCP Token</AlertDialogTitle>
                          <AlertDialogDescription>
                            This immediately disconnects any client using "{token.name}". This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleRevoke(token.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Revoke token
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(revealedToken)}
        onOpenChange={(open) => {
          if (!open) setRevealedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new Personal MCP Token</DialogTitle>
            <DialogDescription>Copy it now before closing this dialog.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">This is the only time the full token will be shown. Treat it like a password.</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted p-2 text-xs font-mono break-all select-all border">
                  {revealedToken}
                </code>
                {revealedToken && <CopyButton text={revealedToken} id="new-token" />}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedToken(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" /> Compatible Clients
          </CardTitle>
          <CardDescription>
            Copy-paste configs for popular MCP-compatible AI tools. Use a Personal MCP Token from this page.
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
                  <li>Replace <code className="text-xs">{TOKEN_PLACEHOLDER}</code> with a Personal MCP Token</li>
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
                <p className="text-sm text-muted-foreground">Run this in your terminal, then replace the token placeholder:</p>
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
                  Add this to <code className="text-xs bg-muted px-1 rounded">.cursor/mcp.json</code> or your VS Code MCP settings:
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
                    Header: <code className="text-xs bg-muted px-1 rounded">Authorization: Bearer &lt;PROJECT_MCP_TOKEN&gt;</code>
                  </li>
                  <li>
                    Header: <code className="text-xs bg-muted px-1 rounded">Accept: application/json, text/event-stream</code>
                  </li>
                  <li>
                    Header: <code className="text-xs bg-muted px-1 rounded">Content-Type: application/json</code>
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
