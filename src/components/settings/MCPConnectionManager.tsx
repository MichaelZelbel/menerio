import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Brain, Copy, Check, Terminal, Monitor, Code2, Sparkles, Eye, EyeOff, Key, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID || "tjeapelvjlmbxafsmjef";
const MCP_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/open-brain-mcp`;
const LOCAL_STORAGE_KEY = "menerio_mcp_key";

const MCP_KEY_NAME = "MCP Connection";
const MCP_SCOPES = ["profile", "notes", "contacts", "actions", "graph", "media", "stats"];

const TOOLS = [
  { name: "search_thoughts", desc: "Semantic search across all your captured thoughts by meaning" },
  { name: "list_recent", desc: "List recent notes with filters by type, topic, person, or date range" },
  { name: "capture_thought", desc: "Save a new thought — auto-generates embedding and metadata" },
  { name: "get_stats", desc: "Summary statistics: totals, top topics, people, recent activity" },
  { name: "get_action_items", desc: "All open action items extracted from notes" },
  { name: "get_person_notes", desc: "All notes mentioning a specific person" },
  { name: "search_images", desc: "Search across all analyzed images and PDFs by description or extracted text" },
  { name: "get_note_media", desc: "Get all media analysis results (images, PDFs) for a specific note" },
  { name: "get_user_profile", desc: "Retrieve the user's profile — identity, preferences, values, goals, and agent instructions" },
];

export function MCPConnectionManager() {
  const { user, session } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const [mcpKey, setMcpKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [existingKeyInfo, setExistingKeyInfo] = useState<{ key_prefix: string; is_active: boolean; created_at: string } | null>(null);

  // Load key from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) setMcpKey(stored);
  }, []);

  // Check if an MCP key already exists on the server
  useEffect(() => {
    if (!session?.access_token) return;
    (async () => {
      const { data, error } = await supabase.functions.invoke("hub-api-keys", {
        method: "GET",
      });
      if (!error && data?.keys) {
        const existing = data.keys.find((k: any) => k.name === MCP_KEY_NAME && k.is_active);
        if (existing) {
          setExistingKeyInfo({ key_prefix: existing.key_prefix, is_active: existing.is_active, created_at: existing.created_at });
        }
      }
    })();
  }, [session?.access_token]);

  const generateKey = async () => {
    if (!session?.access_token) {
      toast.error("You must be logged in to generate a key.");
      return;
    }

    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("hub-api-keys/generate", {
        method: "POST",
        body: { name: MCP_KEY_NAME, scopes: MCP_SCOPES },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const newKey = data.api_key;
      setMcpKey(newKey);
      localStorage.setItem(LOCAL_STORAGE_KEY, newKey);
      setShowKey(true);
      setExistingKeyInfo({ key_prefix: data.key_prefix, is_active: true, created_at: data.created_at });
      toast.success("MCP key generated! Copy it now — you won't see it again.");
    } catch (err: any) {
      toast.error(`Failed to generate key: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const regenerateKey = async () => {
    if (!session?.access_token) return;

    setGenerating(true);
    try {
      // Revoke existing MCP keys first
      const { data: listData } = await supabase.functions.invoke("hub-api-keys", {
        method: "GET",
      });
      if (listData?.keys) {
        for (const key of listData.keys) {
          if (key.name === MCP_KEY_NAME && key.is_active) {
            await supabase.functions.invoke(`hub-api-keys/${key.id}`, {
              method: "DELETE",
            });
          }
        }
      }

      // Generate new one
      await generateKey();
    } catch (err: any) {
      toast.error(`Failed to regenerate key: ${err.message}`);
      setGenerating(false);
    }
  };

  const keyOrPlaceholder = mcpKey || "YOUR_MCP_KEY";
  const chatGptUrl = `${MCP_URL}?key=${keyOrPlaceholder}`;

  const handleCopy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyButton = ({ text, id }: { text: string; id: string }) => (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0"
      onClick={() => handleCopy(text, id)}
    >
      {copied === id ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </Button>
  );

  const claudeDesktopSnippet = `{
  "mcpServers": {
    "menerio": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${MCP_URL}",
        "--header",
        "x-brain-key: ${keyOrPlaceholder}"
      ]
    }
  }
}`;

  const cursorSnippet = claudeDesktopSnippet;

  const claudeCodeCommand = `claude mcp add --transport http menerio ${MCP_URL} --header "x-brain-key: ${keyOrPlaceholder}"`;

  const maskedKey = mcpKey ? `${mcpKey.slice(0, 8)}${"•".repeat(20)}${mcpKey.slice(-4)}` : "";

  return (
    <div className="space-y-6">
      {/* Profile tip */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start gap-2.5 text-sm">
        <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Tip:</span> Make sure your{" "}
          <a href="/dashboard/profile" className="underline text-primary hover:text-primary/80">profile</a>{" "}
          is filled in so your new AI tool can understand who you are. The more context it has, the better it works.
        </p>
      </div>

      {/* MCP Key + Connection URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" /> MCP Access Key
          </CardTitle>
          <CardDescription>
            Generate a personal access key to connect AI tools to your Menerio brain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!mcpKey ? (
            <div className="space-y-3">
              {existingKeyInfo ? (
                <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                  <p className="text-muted-foreground">
                    You have an active MCP key (<code className="text-xs">{existingKeyInfo.key_prefix}…</code>), but the full key is no longer available.
                  </p>
                  <p className="text-muted-foreground">
                    If you've lost it, generate a new one below. The old key will be revoked.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click the button below to generate your personal MCP access key. You'll need it to connect Claude, ChatGPT, Cursor, and other AI tools.
                </p>
              )}
              <Button onClick={existingKeyInfo ? regenerateKey : generateKey} disabled={generating}>
                {generating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
                ) : existingKeyInfo ? (
                  <><RefreshCw className="h-4 w-4 mr-2" /> Regenerate Key</>
                ) : (
                  <><Key className="h-4 w-4 mr-2" /> Generate MCP Key</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                  {showKey ? mcpKey : maskedKey}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <CopyButton text={mcpKey} id="mcp-key" />
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                ⚠ Copy this key now — you won't be able to see it again after leaving this page.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={regenerateKey} disabled={generating}>
                  {generating ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1.5" />}
                  Regenerate
                </Button>
              </div>
            </div>
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

      {/* Available Tools */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Available Tools
          </CardTitle>
          <CardDescription>
            These tools are available to any AI client connected to your MCP server.
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
            <Terminal className="h-5 w-5" /> Connection Guides
          </CardTitle>
          <CardDescription>
            Step-by-step instructions for connecting popular AI tools.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {/* Claude Desktop */}
            <AccordionItem value="claude-desktop">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  <span>Claude Desktop</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Open Claude Desktop → <strong>Settings</strong></li>
                  <li>Go to <strong>Developer</strong> → <strong>Edit Config</strong></li>
                  <li>Add the following to your <code className="text-xs bg-muted px-1 rounded">claude_desktop_config.json</code>:</li>
                </ol>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">{claudeDesktopSnippet}</pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={claudeDesktopSnippet} id="claude-desktop" />
                  </div>
                </div>
                {!mcpKey && (
                  <p className="text-xs text-muted-foreground">
                    Generate your MCP key above to auto-populate the config.
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* ChatGPT */}
            <AccordionItem value="chatgpt">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  <span>ChatGPT</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Go to <strong>Settings</strong> → <strong>Apps</strong> → <strong>Advanced Settings</strong></li>
                  <li>Enable the <strong>Developer</strong> toggle</li>
                  <li>Click <strong>Create App</strong></li>
                  <li>For Authentication, select <strong>None</strong> (the key is embedded in the URL)</li>
                  <li>Paste the URL below and save</li>
                </ol>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto break-all">
                    {chatGptUrl}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={chatGptUrl} id="chatgpt" />
                  </div>
                </div>
                {!mcpKey && (
                  <p className="text-xs text-muted-foreground">
                    Generate your MCP key above to get a ready-to-paste URL.
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Claude Code */}
            <AccordionItem value="claude-code">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4" />
                  <span>Claude Code (CLI)</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">Run this command in your terminal:</p>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto break-all">
                    {claudeCodeCommand}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={claudeCodeCommand} id="claude-code" />
                  </div>
                </div>
                {!mcpKey && (
                  <p className="text-xs text-muted-foreground">
                    Generate your MCP key above to auto-populate the command.
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* Cursor / VS Code */}
            <AccordionItem value="cursor">
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4" />
                  <span>Cursor / VS Code Copilot</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Add this to your <code className="text-xs bg-muted px-1 rounded">.cursor/mcp.json</code> or VS Code MCP settings:
                </p>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">{cursorSnippet}</pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={cursorSnippet} id="cursor" />
                  </div>
                </div>
                {!mcpKey && (
                  <p className="text-xs text-muted-foreground">
                    Generate your MCP key above to auto-populate the config.
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
