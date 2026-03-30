import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNoteNeighborhood, GraphNode, GraphEdge } from "@/hooks/useGraphData";
import { useNoteConnections } from "@/hooks/useGraphData";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  Link2,
  FileText,
  Sparkles,
  Users,
  Hash,
  ArrowRight,
  Plus,
  Loader2,
} from "lucide-react";
import ForceGraph2D from "react-force-graph-2d";

const TYPE_COLORS: Record<string, string> = {
  observation: "hsl(220, 14%, 60%)",
  idea: "hsl(270, 55%, 55%)",
  task: "hsl(38, 92%, 50%)",
  meeting_note: "hsl(205, 78%, 50%)",
  decision: "hsl(175, 60%, 42%)",
  person_note: "hsl(340, 60%, 55%)",
  project: "hsl(152, 60%, 40%)",
  reference: "hsl(15, 70%, 55%)",
  note: "hsl(220, 14%, 70%)",
};

const EDGE_STYLES: Record<string, { dash: number[]; color: string }> = {
  semantic: { dash: [2, 3], color: "hsl(220, 14%, 55%)" },
  shared_person: { dash: [6, 3], color: "hsl(340, 60%, 55%)" },
  shared_topic: { dash: [6, 3], color: "hsl(205, 78%, 50%)" },
  manual_link: { dash: [], color: "hsl(220, 70%, 45%)" },
};

const CONNECTION_TYPE_ICONS: Record<string, typeof Link2> = {
  manual_link: Link2,
  semantic: Sparkles,
  shared_person: Users,
  shared_topic: Hash,
};

const CONNECTION_TYPE_LABELS: Record<string, string> = {
  manual_link: "Manual links",
  semantic: "AI-discovered",
  shared_person: "Shared people",
  shared_topic: "Shared topics",
};

interface LocalGraphPanelProps {
  noteId: string;
  noteTitle: string;
  onNavigate: (noteId: string) => void;
  onClose: () => void;
  onLinkToNote: () => void;
}

export function LocalGraphPanel({
  noteId,
  noteTitle,
  onNavigate,
  onClose,
  onLinkToNote,
}: LocalGraphPanelProps) {
  const { data: graphData, isLoading } = useNoteNeighborhood(noteId, 2);
  const { data: connections = [] } = useNoteConnections(noteId);
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(320);
  const [dimensions, setDimensions] = useState({ width: 300, height: 280 });
  const [graphHeight, setGraphHeight] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [isResizingH, setIsResizingH] = useState(false);
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null);
  const resizeHStartRef = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setDimensions((prev) => ({ width, height: prev.height }));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Keep dimensions.height in sync with graphHeight
  useEffect(() => {
    setDimensions((prev) => ({ ...prev, height: graphHeight }));
  }, [graphHeight]);

  // Drag-to-resize handler
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartRef.current = { y: e.clientY, h: graphHeight };
    setIsResizing(true);

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const delta = ev.clientY - resizeStartRef.current.y;
      const newH = Math.max(150, Math.min(600, resizeStartRef.current.h + delta));
      setGraphHeight(newH);
    };
    const onMouseUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [graphHeight]);

  // Horizontal drag-to-resize handler (drag left edge to widen)
  const onResizeHMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeHStartRef.current = { x: e.clientX, w: panelWidth };
    setIsResizingH(true);

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeHStartRef.current) return;
      const delta = resizeHStartRef.current.x - ev.clientX;
      const newW = Math.max(280, Math.min(800, resizeHStartRef.current.w + delta));
      setPanelWidth(newW);
    };
    const onMouseUp = () => {
      setIsResizingH(false);
      resizeHStartRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [panelWidth]);

  // Center on current note after data loads
  useEffect(() => {
    if (graphRef.current && graphData) {
      setTimeout(() => {
        graphRef.current?.zoomToFit(300, 30);
      }, 500);
    }
  }, [graphData]);

  const graphNodes = useMemo(() => {
    if (!graphData) return [];
    return graphData.nodes.map((n) => ({
      ...n,
      __isCurrent: n.id === noteId,
    }));
  }, [graphData, noteId]);

  const graphLinks = useMemo(() => {
    if (!graphData) return [];
    return graphData.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      strength: e.strength,
    }));
  }, [graphData]);

  // Group connections by type
  const grouped = useMemo(() => {
    const groups: Record<string, typeof connections> = {};
    for (const c of connections) {
      const t = c.connection_type;
      if (!groups[t]) groups[t] = [];
      groups[t].push(c);
    }
    return groups;
  }, [connections]);

  // Build a map of note IDs to titles from graph data
  const noteMap = useMemo(() => {
    const m = new Map<string, string>();
    if (graphData) {
      for (const n of graphData.nodes) m.set(n.id, n.title);
    }
    return m;
  }, [graphData]);

  const totalConnections = connections.length;

  return (
    <div className="border-l border-border bg-background flex flex-col h-full shrink-0 relative" style={{ width: panelWidth }}>
      {/* Horizontal resize handle */}
      <div
        onMouseDown={onResizeHMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-primary/20 transition-colors ${isResizingH ? "bg-primary/30" : ""}`}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-primary" />
          Local Graph
        </h4>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} className="border-b border-border bg-muted/20 relative">
        {isLoading ? (
          <div className="flex items-center justify-center" style={{ height: graphHeight }}>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : graphNodes.length === 0 ? (
          <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: graphHeight }}>
            No connections yet
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={{ nodes: graphNodes, links: graphLinks }}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor="transparent"
            nodeRelSize={4}
            nodeVal={(node: any) => (node.__isCurrent ? 3 : 1)}
            nodeColor={(node: any) => {
              if (node.__isCurrent) return "hsl(var(--primary))";
              const type = node.type || "note";
              return TYPE_COLORS[type] || TYPE_COLORS.note;
            }}
            nodeLabel={() => ""}
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const label = node.title || "Untitled";
              const fontSize = Math.max(10 / globalScale, 2);
              ctx.font = `${node.__isCurrent ? "bold " : ""}${fontSize}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";

              const radius = node.__isCurrent ? Math.sqrt(3) * 4 : 4;
              const yOffset = radius + 2 / globalScale;

              // Background for readability
              const textWidth = ctx.measureText(label).width;
              const padding = 2 / globalScale;
              ctx.fillStyle = "rgba(0,0,0,0.55)";
              ctx.fillRect(
                node.x - textWidth / 2 - padding,
                node.y + yOffset - padding / 2,
                textWidth + padding * 2,
                fontSize + padding
              );

              ctx.fillStyle = "#fff";
              ctx.fillText(label, node.x, node.y + yOffset);
            }}
            linkColor={(link: any) => {
              const style = EDGE_STYLES[link.type] || EDGE_STYLES.semantic;
              return style.color;
            }}
            linkLineDash={(link: any) => {
              const style = EDGE_STYLES[link.type] || EDGE_STYLES.semantic;
              return style.dash.length > 0 ? style.dash : undefined;
            }}
            linkWidth={(link: any) => Math.max(0.5, (link.strength || 0.5) * 2)}
            onNodeClick={(node: any) => {
              if (node.id !== noteId) onNavigate(node.id);
            }}
            cooldownTime={2000}
            d3AlphaDecay={0.05}
            d3VelocityDecay={0.3}
            enableZoomInteraction={true}
            enablePanInteraction={true}
          />
        )}
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className={`h-2 cursor-row-resize flex items-center justify-center border-b border-border hover:bg-accent/50 transition-colors ${isResizing ? "bg-accent" : ""}`}
      >
        <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
      </div>

      {/* Connection stats */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[9px] px-1.5">
            {totalConnections} connections
          </Badge>
          {Object.entries(grouped).map(([type, items]) => (
            <span key={type} className="text-[9px]">
              {items.length} {CONNECTION_TYPE_LABELS[type]?.toLowerCase() || type}
            </span>
          ))}
        </div>
      </div>

      {/* Connection summary list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {Object.entries(grouped).map(([type, items]) => {
            const Icon = CONNECTION_TYPE_ICONS[type] || Link2;
            const label = CONNECTION_TYPE_LABELS[type] || type;
            return (
              <div key={type}>
                <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Icon className="h-3 w-3" />
                  {label} ({items.length})
                </h5>
                <div className="space-y-0.5">
                  {items.map((conn) => {
                    const linkedId =
                      conn.source_note_id === noteId
                        ? conn.target_note_id
                        : conn.source_note_id;
                    const linkedTitle = noteMap.get(linkedId) || "Untitled";
                    return (
                      <button
                        key={conn.id}
                        onClick={() => onNavigate(linkedId)}
                        className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent transition-colors group"
                      >
                        <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate flex-1 text-foreground group-hover:text-primary">
                          {linkedTitle}
                        </span>
                        <span className="text-[9px] text-muted-foreground shrink-0">
                          {Math.round((conn.strength || 0) * 100)}%
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {totalConnections === 0 && !isLoading && (
            <div className="text-center py-4">
              <Link2 className="h-5 w-5 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-[10px] text-muted-foreground">
                No connections yet. Use [[wikilinks]] or let AI discover links.
              </p>
            </div>
          )}

          <Separator />

          {/* Link to this note action */}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1.5"
            onClick={onLinkToNote}
          >
            <Plus className="h-3 w-3" />
            Link to this note
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
