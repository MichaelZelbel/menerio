import { useState, useMemo } from "react";
import { Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProfileCategory, ProfileEntry, AgentInstruction } from "@/hooks/useProfile";

interface Props {
  categories: ProfileCategory[];
  entries: ProfileEntry[];
  instructions: AgentInstruction[];
}

export function ExportTab({ categories, entries, instructions }: Props) {
  const [scope, setScope] = useState("all");
  const [copied, setCopied] = useState(false);

  const exportText = useMemo(() => {
    const filteredCats = categories.filter(
      (c) => scope === "all" || c.visibility_scope === "all" || c.visibility_scope === scope
    );

    const lines: string[] = ["## About Me", ""];
    for (const cat of filteredCats) {
      const catEntries = entries.filter((e) => e.category_id === cat.id);
      if (catEntries.length === 0) continue;
      lines.push(`### ${cat.name}`);
      for (const entry of catEntries) {
        lines.push(`- **${entry.label}**: ${entry.value}`);
      }
      lines.push("");
    }

    const activeInstructions = instructions.filter(
      (i) => i.is_active && (scope === "all" || i.applies_to === "all" || i.applies_to === scope)
    );
    if (activeInstructions.length > 0) {
      lines.push("### Instructions for AI");
      for (const inst of activeInstructions) {
        lines.push(`- ${inst.instruction}`);
      }
      lines.push("");
    }

    return lines.join("\n").trim();
  }, [categories, entries, instructions, scope]);

  const handleCopy = () => {
    navigator.clipboard.writeText(exportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([exportText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-profile.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Export & Share</CardTitle>
        <CardDescription>
          Generate a formatted "About Me" block to paste into any AI tool's system prompt or custom instructions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground">Scope:</label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-48 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
              <SelectItem value="health">Health</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Textarea
          readOnly
          value={exportText}
          className="text-sm font-mono min-h-[200px] bg-muted/30"
          rows={12}
        />

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {copied ? "Copied!" : "Copy to clipboard"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5 mr-1" /> Download .md
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
