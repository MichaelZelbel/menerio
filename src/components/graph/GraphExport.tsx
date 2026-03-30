import { useState, useMemo } from "react";
import { useGraphData } from "@/hooks/useGraphData";
import { useNotes } from "@/hooks/useNotes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileJson, Table, Loader2 } from "lucide-react";
import { showToast } from "@/lib/toast";

export function GraphExportButton() {
  const { data: graphData } = useGraphData({ limit: 1000 });
  const [exporting, setExporting] = useState(false);

  const exportJSON = () => {
    if (!graphData) return;
    const blob = new Blob([JSON.stringify(graphData, null, 2)], { type: "application/json" });
    downloadBlob(blob, "menerio-graph.json");
    showToast.success("Graph exported as JSON");
  };

  const exportCSV = () => {
    if (!graphData) return;
    // Nodes CSV
    const nodeHeaders = "id,title,type,topics,tags,created_at\n";
    const nodeRows = graphData.nodes.map((n) =>
      [n.id, csvEscape(n.title), n.type, csvEscape((n.topics || []).join(";")), csvEscape((n.tags || []).join(";")), n.created_at].join(",")
    ).join("\n");
    const nodesBlob = new Blob([nodeHeaders + nodeRows], { type: "text/csv" });
    downloadBlob(nodesBlob, "menerio-nodes.csv");

    // Edges CSV
    const edgeHeaders = "id,source,target,type,strength\n";
    const edgeRows = graphData.edges.map((e) =>
      [e.id, e.source, e.target, e.type, e.strength].join(",")
    ).join("\n");
    const edgesBlob = new Blob([edgeHeaders + edgeRows], { type: "text/csv" });
    downloadBlob(edgesBlob, "menerio-edges.csv");

    showToast.success("Graph exported as CSV (2 files)");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" disabled={!graphData}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportJSON}>
          <FileJson className="mr-2 h-4 w-4" />
          Export as JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportCSV}>
          <Table className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
