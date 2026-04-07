import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Brain, Copy, Check, Terminal, Monitor, Code2, Sparkles, Eye, EyeOff } from "lucide-react";

const SUPABASE_PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID || "tjeapelvjlmbxafsmjef";
const MCP_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/open-brain-mcp`;
const LOCAL_STORAGE_KEY = "menerio_mcp_access_key";

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
  const { user } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) setAccessKey(stored);
  }, []);

  const handleKeyChange = (value: string) => {
    setAccessKey(value);
    if (value) {
      localStorage.setItem(LOCAL_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  };

  const keyOrPlaceholder = accessKey || "YOUR_ACCESS_KEY";
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

      {/* Connection URL */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" /> MCP Connection
          </CardTitle>
          <CardDescription>
            Connect any AI tool to your Menerio brain via the Model Context Protocol.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>MCP Server URL</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all border">
                {MCP_URL}
              </code>
              <CopyButton text={MCP_URL} id="url" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Access Key</Label>
            <p className="text-xs text-muted-foreground mb-1.5">
              Paste the value you set as <code className="text-xs">MCP_ACCESS_KEY</code> in your Supabase project secrets. It will be stored locally in your browser and used to populate the config snippets below.
            </p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={accessKey}
                  onChange={(e) => handleKeyChange(e.target.value)}
                  placeholder="Paste your MCP_ACCESS_KEY here"
                  className="pr-10 font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <CopyButton text={accessKey} id="access-key" />
            </div>
            {accessKey && (
              <p className="text-xs text-green-600 dark:text-green-400">
                ✓ Key saved — config snippets below are ready to copy.
              </p>
            )}
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
                {!accessKey && (
                  <p className="text-xs text-muted-foreground">
                    Enter your access key above to auto-populate the config.
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
                {!accessKey && (
                  <p className="text-xs text-muted-foreground">
                    Enter your access key above to get a ready-to-paste URL.
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
                {!accessKey && (
                  <p className="text-xs text-muted-foreground">
                    Enter your access key above to auto-populate the command.
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
                {!accessKey && (
                  <p className="text-xs text-muted-foreground">
                    Enter your access key above to auto-populate the config.
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
