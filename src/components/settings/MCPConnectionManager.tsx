import { useState } from "react";
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
import { Brain, Copy, Check, RefreshCw, Terminal, Monitor, Code2, Sparkles } from "lucide-react";

const SUPABASE_PROJECT_REF = import.meta.env.VITE_SUPABASE_PROJECT_ID || "tjeapelvjlmbxafsmjef";
const MCP_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/open-brain-mcp`;

const TOOLS = [
  { name: "search_thoughts", desc: "Semantic search across all your captured thoughts by meaning" },
  { name: "list_recent", desc: "List recent notes with filters by type, topic, person, or date range" },
  { name: "capture_thought", desc: "Save a new thought — auto-generates embedding and metadata" },
  { name: "get_stats", desc: "Summary statistics: totals, top topics, people, recent activity" },
  { name: "get_action_items", desc: "All open action items extracted from notes" },
  { name: "get_person_notes", desc: "All notes mentioning a specific person" },
];

export function MCPConnectionManager() {
  const { user } = useAuth();
  const [copied, setCopied] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
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
            <p className="text-xs text-muted-foreground">
              Your MCP access key is configured as a server-side secret (<code className="text-xs">MCP_ACCESS_KEY</code>).
              It must be sent as the <code className="text-xs">x-brain-key</code> header or as a <code className="text-xs">?key=</code> query parameter.
            </p>
            <p className="text-xs text-muted-foreground">
              To change it, update the <code className="text-xs">MCP_ACCESS_KEY</code> secret in your Supabase project settings.
            </p>
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
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">{`{
  "mcpServers": {
    "menerio": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${MCP_URL}",
        "--header",
        "x-brain-key: YOUR_ACCESS_KEY"
      ]
    }
  }
}`}</pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton
                      text={`{\n  "mcpServers": {\n    "menerio": {\n      "command": "npx",\n      "args": [\n        "-y", "mcp-remote",\n        "${MCP_URL}",\n        "--header",\n        "x-brain-key: YOUR_ACCESS_KEY"\n      ]\n    }\n  }\n}`}
                      id="claude-desktop"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Replace <code className="text-xs">YOUR_ACCESS_KEY</code> with your MCP access key.
                </p>
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
                  <li>Go to <strong>Settings</strong> → <strong>Apps & Connectors</strong></li>
                  <li>Enable <strong>Developer mode</strong></li>
                  <li>Click <strong>Create</strong> → <strong>MCP Server</strong></li>
                  <li>Paste the MCP URL (with <code className="text-xs bg-muted px-1 rounded">?key=YOUR_ACCESS_KEY</code> appended)</li>
                  <li>Save and start using tools in any conversation</li>
                </ol>
                <div className="relative">
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto break-all">
                    {`${MCP_URL}?key=YOUR_ACCESS_KEY`}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={`${MCP_URL}?key=YOUR_ACCESS_KEY`} id="chatgpt" />
                  </div>
                </div>
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
                    {`claude mcp add --transport http menerio ${MCP_URL} --header "x-brain-key: YOUR_ACCESS_KEY"`}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton
                      text={`claude mcp add --transport http menerio ${MCP_URL} --header "x-brain-key: YOUR_ACCESS_KEY"`}
                      id="claude-code"
                    />
                  </div>
                </div>
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
                  <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-x-auto">{`{
  "mcpServers": {
    "menerio": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "${MCP_URL}",
        "--header",
        "x-brain-key: YOUR_ACCESS_KEY"
      ]
    }
  }
}`}</pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton
                      text={`{\n  "mcpServers": {\n    "menerio": {\n      "command": "npx",\n      "args": [\n        "-y", "mcp-remote",\n        "${MCP_URL}",\n        "--header",\n        "x-brain-key: YOUR_ACCESS_KEY"\n      ]\n    }\n  }\n}`}
                      id="cursor"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
