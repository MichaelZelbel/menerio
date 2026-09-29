import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { graphDataQuery, type GraphData } from "@/hooks/useGraphData";
import { useAuth } from "@/contexts/AuthContext";
import { BRAND } from "@/lib/brand";
import { functionErrorMessage } from "@/lib/function-error";
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);

  // The 1,000-node graph is fetched when an export is chosen, not when the
  // page opens: the Note Graph page used to download it on every visit just
  // to enable this button.
  const withGraph = async (write: (graphData: GraphData) => void) => {
    if (exporting) return;
    setExporting(true);
    try {
      const graphData = await queryClient.fetchQuery(graphDataQuery(user?.id, { limit: 1000 }));
      write(graphData);
    } catch (err) {
      showToast.error(await functionErrorMessage(err, "The graph could not be exported. Try again."));
    } finally {
      setExporting(false);
    }
  };

  const exportJSON = () =>
    withGraph((graphData) => {
      const blob = new Blob([JSON.stringify(graphData, null, 2)], { type: "application/json" });
      downloadBlob(blob, `${BRAND.id}-graph.json`);
      showToast.success("Graph exported as JSON");
    });

  const exportCSV = () =>
    withGraph((graphData) => {
      // Nodes CSV
      const nodeHeaders = "id,title,type,topics,tags,created_at\n";
      const nodeRows = graphData.nodes.map((n) =>
        [n.id, csvEscape(n.title), n.type, csvEscape((n.topics || []).join(";")), csvEscape((n.tags || []).join(";")), n.created_at].join(",")
      ).join("\n");
      const nodesBlob = new Blob([nodeHeaders + nodeRows], { type: "text/csv" });
      downloadBlob(nodesBlob, `${BRAND.id}-nodes.csv`);

      // Edges CSV
      const edgeHeaders = "id,source,target,type,strength\n";
      const edgeRows = graphData.edges.map((e) =>
        [e.id, e.source, e.target, e.type, e.strength].join(",")
      ).join("\n");
      const edgesBlob = new Blob([edgeHeaders + edgeRows], { type: "text/csv" });
      downloadBlob(edgesBlob, `${BRAND.id}-edges.csv`);

      showToast.success("Graph exported as CSV (2 files)");
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" disabled={!user || exporting}>
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
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
