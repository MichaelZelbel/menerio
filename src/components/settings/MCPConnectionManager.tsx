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
  Copy,
  Check,
  Plug,
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

type ToolCategory = {
  category: string;
  blurb: string;
  tools: { name: string; desc: string }[];
};

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    category: "Notes",
    blurb: "Capture, search, and manage thoughts.",
    tools: [
      { name: "search_notes", desc: "Semantic search across all notes by meaning." },
      { name: "list_recent_notes", desc: "Recent notes, filterable by type, topic, person, or date." },
      { name: "capture_note", desc: "Save a new note — title, embedding, topics, people and actions extracted automatically." },
      { name: "update_note", desc: "Edit an existing note." },
      { name: "trash_note", desc: "Move a note to trash." },
      { name: "get_stats", desc: "Totals, top topics, people, recent activity." },
      { name: "get_action_items", desc: "Open action items extracted from notes." },
    ],
  },
  {
    category: "People",
    blurb: "Contacts and their interaction history.",
    tools: [
      { name: "list_people", desc: "List all contacts." },
      { name: "search_contacts", desc: "Search contacts by name, company, or tag." },
      { name: "get_contact_context", desc: "Full context for one person: profile, notes, interactions, moments." },
      { name: "get_person_notes", desc: "All notes mentioning a specific person." },
      { name: "log_interaction", desc: "Record an interaction with a contact." },
    ],
  },
  {
    category: "Moments (timeline)",
    blurb: "Structured life events on the user's timeline.",
    tools: [
      { name: "create_moment_with_ai", desc: "Preferred. Create a Moment from a natural-language description; AI fills in structured fields." },
      { name: "list_moments", desc: "List recent Moments, optionally filtered." },
      { name: "search_moments", desc: "Search Moments by content or participants." },
    ],
  },
  {
    category: "Groups",
    blurb: "Goal-oriented sets of people with stages and next steps.",
    tools: [
      { name: "list_groups", desc: "List active Groups with counts and goals." },
      { name: "get_group", desc: "Group detail: members, interactions, next steps, briefing." },
      { name: "create_group", desc: "Create a new Group." },
      { name: "add_group_member", desc: "Add or restore a Group member." },
      { name: "update_group_membership", desc: "Update stage/status, priority, notes, or archive." },
      { name: "log_group_interaction", desc: "Record an interaction in the Group context." },
      { name: "create_group_next_step", desc: "Add an open next-step action for a membership." },
      { name: "suggest_group_next_step", desc: "AI-suggest one next step (does not save)." },
      { name: "generate_group_briefing", desc: "Generate and save a Markdown briefing for a Group." },
      { name: "add_members_from_notes", desc: "AI-add or propose Group members from notes." },
      { name: "preview_group_members_from_note", desc: "Preview deterministic import from a Markdown table/list note." },
      { name: "import_group_members_from_note", desc: "Import members deterministically from a Markdown table/list note." },
      { name: "review_group_member_suggestion", desc: "Apply Keep / Roll Back / Never Again to a Review Queue item." },
    ],
  },
  {
    category: "Collections",
    blurb: "User-defined structured data sets with custom schemas.",
    tools: [
      { name: "list_collections", desc: "List all collections with their agent_instructions." },
      { name: "get_collection_schema", desc: "Field schema (keys, types, options) for one collection." },
      { name: "add_collection_item", desc: "Add an item to a collection." },
      { name: "update_collection_item", desc: "Update an existing collection item." },
      { name: "list_collection_items", desc: "Search and list items within a collection." },
      { name: "search_all_collections", desc: "Search items across every collection at once." },
    ],
  },
  {
    category: "Lexicon",
    blurb: "Durable, synthesized knowledge pages.",
    tools: [
      { name: "lexicon_search", desc: "Search Lexicon pages by title, slug, or content." },
      { name: "lexicon_get_page", desc: "Read a full Lexicon page with sources and backlinks." },
      { name: "lexicon_create_page", desc: "Create a reviewed Lexicon page." },
      { name: "lexicon_update_page", desc: "Update a reviewed Lexicon page." },
      { name: "lexicon_run_lint", desc: "Run the Lexicon health check (broken links, orphans, drift, contradictions)." },
    ],
  },
  {
    category: "Knowledge graph",
    blurb: "Connections between notes.",
    tools: [
      { name: "get_connected_notes", desc: "Notes linked to a given note." },
      { name: "find_path", desc: "Find a path of connections between two notes." },
      { name: "get_clusters", desc: "Topic clusters across the knowledge graph." },
    ],
  },
  {
    category: "Media",
    blurb: "Images and PDFs with AI analysis.",
    tools: [
      { name: "search_images", desc: "Search analyzed images and PDFs by description or extracted text." },
      { name: "get_note_media", desc: "Media analysis attached to a note." },
    ],
  },
  {
    category: "Identity",
    blurb: "Who the user is.",
    tools: [
      { name: "get_user_profile", desc: "Identity, preferences, values, goals, and agent_instructions. Call once at session start." },
    ],
  },
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

  const agentPrompt = useMemo(
    () => `You have access to Menerio — the user's personal AI memory and second brain.

# Connection
- MCP Server URL: ${MCP_URL}
- Transport: MCP Streamable HTTP
- Auth header: \`Authorization: Bearer <PROJECT_MCP_TOKEN>\` (token starts with \`${MCP_TOKEN_PREFIX}\`)
- Required headers:
  - \`Authorization: Bearer <PROJECT_MCP_TOKEN>\`
  - \`Accept: application/json, text/event-stream\`
  - \`Content-Type: application/json\`
- The token is long-lived; it stays valid until the user revokes it or its optional expiration date passes.
- Keep the endpoint exactly as shown above. Do not add /mcp, /sse, /v1, or any other path.
- Verification flow: call \`initialize\`, then \`tools/list\`, then \`tools/call\` with the safe read-only tool \`get_user_profile\`.
- If a tool call returns \`401 Invalid or revoked token\`, ask the user for a new Personal MCP Token from Menerio → Settings → MCP Server instead of retrying.

# What Menerio is
Menerio stores the user's notes, People (contacts with interaction history), Moments (structured timeline events), Groups (goal-oriented sets of people), Collections (user-defined structured data with custom schemas), Lexicon pages (durable synthesized knowledge), a knowledge graph of links between notes, media (images/PDFs with AI descriptions), and a structured profile (identity, preferences, values, goals, agent instructions).

# Available tools
Always call \`tools/list\` at session start to discover the live, authoritative tool surface — the categories below are a guide, not an exhaustive list, and the server gains new tools over time.

- **Notes** — \`search_notes\`, \`list_recent_notes\`, \`capture_note\`, \`update_note\`, \`trash_note\`, \`get_stats\`, \`get_action_items\`.
- **People** — \`list_people\`, \`search_contacts\`, \`get_contact_context\`, \`get_person_notes\`, \`log_interaction\`.
- **Moments** — \`create_moment_with_ai\` (preferred for natural-language input), \`list_moments\`, \`search_moments\`.
- **Groups** — \`list_groups\`, \`get_group\`, \`create_group\`, \`add_group_member\`, \`update_group_membership\`, \`log_group_interaction\`, \`create_group_next_step\`, \`generate_group_briefing\`, plus AI suggestion/import helpers.
- **Collections** — \`list_collections\`, \`get_collection_schema\`, \`add_collection_item\`, \`update_collection_item\`, \`list_collection_items\`, \`search_all_collections\`. Honour each collection's \`agent_instructions\`.
- **Lexicon** — \`lexicon_search\`, \`lexicon_get_page\`, \`lexicon_create_page\`, \`lexicon_update_page\`, \`lexicon_run_lint\`.
- **Knowledge graph** — \`get_connected_notes\`, \`find_path\`, \`get_clusters\`.
- **Media** — \`search_images\`, \`get_note_media\`.
- **Identity** — \`get_user_profile\`.

# How to behave
- On first use in a conversation, call \`get_user_profile\` so your answers are personalised. Honour any \`agent_instructions\` returned.
- Early in a session, also call \`list_collections\` so you know which user-defined collections exist and how the user wants to capture into each one.
- When the user references something they "remember", "wrote down", "captured", or asks "what do I know about X", call \`search_notes\` (and \`lexicon_search\` for durable synthesized knowledge) before answering from your own memory.
- When the user shares a new fact, decision, idea, observation, or meeting note worth keeping, call \`capture_note\` — don't ask for permission for short factual captures; do confirm for long-form content. If the content clearly belongs in a collection, prefer \`add_collection_item\`.
- For events that happened at a point in time and matter on the user's timeline (meetings, milestones, conversations), prefer \`create_moment_with_ai\`.
- Output style: concise. For lists of notes, show one bullet per item with title + date. Only show full content when explicitly asked.
- After any write, end with a one-line confirmation of what was saved and where.
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
                Long-lived, revocable tokens for any MCP-compatible AI client.
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
                      placeholder="My laptop"
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
            <p className="text-xs text-muted-foreground">
              Only tokens with prefix <code className="font-mono">mnr_mcp_</code> work here (the keys under "Hub API Keys" are for a different API and will be rejected).
            </p>
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
            <Plug className="h-5 w-5" /> Protocol
          </CardTitle>
          <CardDescription>
            Menerio exposes a standard MCP server. Point any MCP-compatible client at the endpoint below using a Personal MCP Token from this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-[140px_1fr] sm:items-center">
            <span className="text-muted-foreground">Transport</span>
            <span><strong>MCP Streamable HTTP</strong></span>

            <span className="text-muted-foreground">Endpoint</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                {MCP_URL}
              </code>
              <CopyButton text={MCP_URL} id="protocol-url" />
            </div>

            <span className="text-muted-foreground">Auth header</span>
            <code className="rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
              Authorization: Bearer &lt;PROJECT_MCP_TOKEN&gt;
            </code>

            <span className="text-muted-foreground">Required headers</span>
            <div className="space-y-1">
              <code className="block rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                Accept: application/json, text/event-stream
              </code>
              <code className="block rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                Content-Type: application/json
              </code>
            </div>

            <span className="text-muted-foreground">Alternate auth</span>
            <span className="text-muted-foreground">
              Clients that can't set custom headers (e.g. ChatGPT custom connectors) can append{" "}
              <code className="font-mono text-foreground">?key=&lt;PROJECT_MCP_TOKEN&gt;</code> to the URL instead.
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Keep the endpoint exactly as shown — don't append <code className="font-mono">/mcp</code>, <code className="font-mono">/sse</code>, or any other path.
            The token must start with <code className="font-mono">mnr_mcp_</code>.
          </p>
        </CardContent>
      </Card>

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
            Tools currently exposed to any AI agent connected to your MCP server, grouped by area.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {TOOL_CATEGORIES.map((group) => (
            <div key={group.category} className="space-y-2">
              <div>
                <h4 className="text-sm font-semibold">{group.category}</h4>
                <p className="text-xs text-muted-foreground">{group.blurb}</p>
              </div>
              <div className="space-y-2">
                {group.tools.map((tool) => (
                  <div key={tool.name} className="flex items-start gap-3 rounded-lg border p-3">
                    <Badge variant="outline" className="mt-0.5 font-mono text-[10px] shrink-0">
                      {tool.name}
                    </Badge>
                    <p className="text-sm text-muted-foreground">{tool.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            The authoritative list always comes from <code className="font-mono">tools/list</code> on the live MCP server — new tools may be available before this page reflects them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
