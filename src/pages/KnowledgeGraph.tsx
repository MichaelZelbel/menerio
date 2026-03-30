import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { useGraphData, GraphNode, GraphEdge } from "@/hooks/useGraphData";
import { OrphanNotesDetector } from "@/components/graph/OrphanNotesDetector";
import { BridgeNotesHighlighter, TopicClustersView, useBridgeNoteIds } from "@/components/graph/GraphAnalytics";
import { GraphExportButton } from "@/components/graph/GraphExport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Search,
  FileText,
  X,
  Maximize2,
  Minimize2,
  Filter,
  ChevronRight,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import ForceGraph2D from "react-force-graph-2d";

// Color palette for note types using design system hues
const TYPE_COLORS: Record<string, string> = {
  observation: "hsl(220, 14%, 60%)",
  idea: "hsl(270, 55%, 55%)",
  task: "hsl(38, 92%, 50%)",
  meeting_note: "hsl(205, 78%, 50%)",
  decision: "hsl(175, 60%, 42%)",
  person_note: "hsl(340, 60%, 55%)",
  project: "hsl(152, 60%, 40%)",
  reference: "hsl(15, 70%, 55%)",
  daily_note: "hsl(45, 80%, 50%)",
  note: "hsl(220, 14%, 70%)",
};

// Edge style config
const EDGE_STYLES: Record<string, { dash: number[]; color: string; opacity: number }> = {
  semantic: { dash: [2, 3], color: "hsl(220, 14%, 55%)", opacity: 0.3 },
  shared_person: { dash: [6, 3], color: "hsl(340, 60%, 55%)", opacity: 0.5 },
  shared_topic: { dash: [6, 3], color: "hsl(205, 78%, 50%)", opacity: 0.5 },
  manual_link: { dash: [], color: "hsl(220, 70%, 45%)", opacity: 0.8 },
};

interface ForceNode extends GraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  __connectionCount?: number;
}

interface Filters {
  searchTerm: string;
  minStrength: number;
  showSemantic: boolean;
  showSharedPerson: boolean;
  showSharedTopic: boolean;
  showManualLink: boolean;
  noteTypes: Set<string>;
  showOrphans: boolean;
  sizeMode: "connections" | "uniform";
  labelMode: "hover" | "always" | "never";
}

const ALL_NOTE_TYPES = [
  "observation", "idea", "task", "meeting_note", "decision",
  "person_note", "project", "reference", "daily_note", "note",
];

export default function KnowledgeGraph() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [selectedNode, setSelectedNode] = useState<ForceNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [sidebarTab, setSidebarTab] = useState<"filters" | "analytics">("filters");
  const bridgeNoteIds = useBridgeNoteIds();

  const [filters, setFilters] = useState<Filters>({
    searchTerm: "",
    minStrength: 0,
    showSemantic: true,
    showSharedPerson: true,
    showSharedTopic: true,
    showManualLink: true,
    noteTypes: new Set(ALL_NOTE_TYPES),
    showOrphans: false,
    sizeMode: "connections",
    labelMode: "hover",
  });

  // Fetch graph data from edge function
  const { data: graphData, isLoading } = useGraphData({ limit: 200, min_strength: filters.minStrength });

  // Measure container
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width || 800,
          height: fullscreen ? window.innerHeight - 10 : Math.max(rect.height, 550),
        });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  // Build filtered graph for ForceGraph2D
  const processedGraph = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };

    const enabledTypes = new Set<string>();
    if (filters.showSemantic) enabledTypes.add("semantic");
    if (filters.showSharedPerson) enabledTypes.add("shared_person");
    if (filters.showSharedTopic) enabledTypes.add("shared_topic");
    if (filters.showManualLink) enabledTypes.add("manual_link");

    // Filter edges
    let edges = graphData.edges.filter(
      (e) => enabledTypes.has(e.type) && e.strength >= filters.minStrength
    );

    // Filter nodes
    let nodes = graphData.nodes.filter((n) => filters.noteTypes.has(n.type || "note"));

    // Search filter
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      nodes = nodes.filter((n) => n.title.toLowerCase().includes(term));
    }

    const nodeIds = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    // Count connections per node
    const connCount = new Map<string, number>();
    for (const e of edges) {
      connCount.set(e.source, (connCount.get(e.source) || 0) + 1);
      connCount.set(e.target, (connCount.get(e.target) || 0) + 1);
    }

    // Filter orphans
    if (!filters.showOrphans) {
      nodes = nodes.filter((n) => (connCount.get(n.id) || 0) > 0);
      const remaining = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => remaining.has(e.source) && remaining.has(e.target));
    }

    // Build ForceGraph2D data
    const forceNodes: ForceNode[] = nodes.map((n) => ({
      ...n,
      __connectionCount: connCount.get(n.id) || 0,
    }));

    const forceLinks = edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
      strength: e.strength,
    }));

    return { nodes: forceNodes, links: forceLinks };
  }, [graphData, filters]);

  // Node sizing
  const getNodeSize = useCallback(
    (node: ForceNode) => {
      if (filters.sizeMode === "uniform") return 6;
      const count = node.__connectionCount || 0;
      return Math.max(4, Math.min(18, 4 + count * 2));
    },
    [filters.sizeMode]
  );

  // Node color
  const getNodeColor = useCallback((node: ForceNode) => {
    return TYPE_COLORS[node.type] || TYPE_COLORS.note;
  }, []);

  // Canvas renderer
  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = getNodeSize(node);
      const isHovered = hoveredNode === node.id;
      const isSelected = selectedNode?.id === node.id;
      const isDimmed = hoveredNode && !isHovered && !isNeighbor(node.id);
      const color = getNodeColor(node);

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, isHovered || isSelected ? size + 2 : size, 0, 2 * Math.PI);
      ctx.fillStyle = isDimmed ? adjustAlpha(color, 0.2) : color;
      ctx.fill();

      // Bridge note glow
      if (bridgeNoteIds.has(node.id) && !isDimmed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = "hsla(38, 92%, 50%, 0.4)";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      if (isSelected) {
        ctx.strokeStyle = "hsl(220, 70%, 45%)";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Labels
      const showLabel =
        filters.labelMode === "always" ||
        (filters.labelMode === "hover" && (isHovered || isSelected)) ||
        (globalScale > 2.5 && !isDimmed);

      if (showLabel) {
        const fontSize = Math.max(11 / globalScale, 3);
        ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isDimmed ? "hsla(220, 25%, 30%, 0.3)" : "hsl(220, 25%, 20%)";
        const label = (node.title || "").length > 28 ? node.title.slice(0, 25) + "…" : node.title;
        ctx.fillText(label, node.x, node.y + size + 3 / globalScale);
      }
    },
    [hoveredNode, selectedNode, filters.labelMode, filters.sizeMode, getNodeSize, getNodeColor]
  );

  // Track neighbors of hovered node for dimming
  const neighborsRef = useRef(new Set<string>());
  const isNeighbor = useCallback((id: string) => neighborsRef.current.has(id), []);

  useEffect(() => {
    if (!hoveredNode) {
      neighborsRef.current = new Set();
      return;
    }
    const neighbors = new Set<string>();
    neighbors.add(hoveredNode);
    for (const l of processedGraph.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as any).id;
      const t = typeof l.target === "string" ? l.target : (l.target as any).id;
      if (s === hoveredNode) neighbors.add(t);
      if (t === hoveredNode) neighbors.add(s);
    }
    neighborsRef.current = neighbors;
  }, [hoveredNode, processedGraph.links]);

  // Link canvas renderer
  const linkCanvasObject = useCallback(
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const style = EDGE_STYLES[link.type] || EDGE_STYLES.semantic;
      const source = link.source;
      const target = link.target;
      if (!source.x || !target.x) return;

      const isDimmed = hoveredNode && !neighborsRef.current.has(source.id) && !neighborsRef.current.has(target.id);
      const width = Math.max(0.5, link.strength * 2.5) / globalScale;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = isDimmed ? adjustAlpha(style.color, 0.05) : adjustAlpha(style.color, style.opacity);
      ctx.lineWidth = width;

      if (style.dash.length > 0) {
        ctx.setLineDash(style.dash.map((d) => d / globalScale));
      } else {
        ctx.setLineDash([]);
      }

      ctx.stroke();
      ctx.setLineDash([]);

      // Arrow for manual links
      if (link.type === "manual_link" && globalScale > 1) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len === 0) return;
        const nodeSize = getNodeSize(target);
        const arrowLen = 6 / globalScale;
        const arrowX = target.x - (dx / len) * (nodeSize + 2);
        const arrowY = target.y - (dy / len) * (nodeSize + 2);
        const angle = Math.atan2(dy, dx);

        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(
          arrowX - arrowLen * Math.cos(angle - Math.PI / 6),
          arrowY - arrowLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          arrowX - arrowLen * Math.cos(angle + Math.PI / 6),
          arrowY - arrowLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = style.color;
        ctx.fill();
      }
    },
    [hoveredNode, getNodeSize]
  );

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node);
  }, []);

  const handleNodeDoubleClick = useCallback(
    (node: any) => {
      navigate(`/dashboard/notes/${node.id}`);
    },
    [navigate]
  );

  const handleSearch = useCallback(
    (term: string) => {
      setFilters((f) => ({ ...f, searchTerm: term }));
      if (term && graphRef.current) {
        const node = processedGraph.nodes.find((n) =>
          n.title.toLowerCase().includes(term.toLowerCase())
        );
        if (node && node.x !== undefined && node.y !== undefined) {
          graphRef.current.centerAt(node.x, node.y, 500);
          graphRef.current.zoom(3, 500);
          setSelectedNode(node);
        }
      }
    },
    [processedGraph.nodes]
  );

  const toggleNoteType = useCallback((type: string) => {
    setFilters((f) => {
      const next = new Set(f.noteTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...f, noteTypes: next };
    });
  }, []);

  // Connection details for selected node
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return processedGraph.links.filter((l) => {
      const s = typeof l.source === "string" ? l.source : (l.source as any).id;
      const t = typeof l.target === "string" ? l.target : (l.target as any).id;
      return s === selectedNode.id || t === selectedNode.id;
    });
  }, [selectedNode, processedGraph.links]);

  const selectedNeighborNodes = useMemo(() => {
    if (!selectedNode) return [];
    const neighborIds = new Set<string>();
    for (const e of selectedNodeEdges) {
      const s = typeof e.source === "string" ? e.source : (e.source as any).id;
      const t = typeof e.target === "string" ? e.target : (e.target as any).id;
      if (s !== selectedNode.id) neighborIds.add(s);
      if (t !== selectedNode.id) neighborIds.add(t);
    }
    return processedGraph.nodes.filter((n) => neighborIds.has(n.id));
  }, [selectedNode, selectedNodeEdges, processedGraph.nodes]);

  return (
    <div className={fullscreen ? "fixed inset-0 z-50 bg-background flex flex-col" : "flex flex-col h-full"}>
      <SEOHead title="Knowledge Graph — Menerio" noIndex />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background shrink-0">
        <div>
          <h1 className="text-lg font-display font-bold">Knowledge Graph</h1>
          <p className="text-xs text-muted-foreground">
            {processedGraph.nodes.length} nodes · {processedGraph.links.length} edges
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filters.searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search nodes…"
              className="pl-8 h-8 text-xs"
            />
            {filters.searchTerm && (
              <button
                onClick={() => setFilters((f) => ({ ...f, searchTerm: "" }))}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setFullscreen(!fullscreen)}>
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Filter sidebar */}
        {showFilters && (
          <div className="w-56 shrink-0 border-r border-border bg-muted/10 overflow-y-auto p-3 space-y-4">
            {/* Connection types */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Connection Types
              </h3>
              <div className="space-y-2">
                {[
                  { key: "showManualLink", label: "Manual Links", color: EDGE_STYLES.manual_link.color },
                  { key: "showSemantic", label: "Semantic", color: EDGE_STYLES.semantic.color },
                  { key: "showSharedPerson", label: "Shared Person", color: EDGE_STYLES.shared_person.color },
                  { key: "showSharedTopic", label: "Shared Topic", color: EDGE_STYLES.shared_topic.color },
                ].map(({ key, label, color }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      checked={(filters as any)[key]}
                      onCheckedChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}
                      className="scale-75"
                    />
                    <div className="h-2 w-4 rounded-full" style={{ background: color }} />
                    <Label className="text-[11px]">{label}</Label>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Min strength */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Min Strength: {filters.minStrength.toFixed(1)}
              </h3>
              <Slider
                value={[filters.minStrength]}
                min={0}
                max={1}
                step={0.1}
                onValueChange={([v]) => setFilters((f) => ({ ...f, minStrength: v }))}
                className="w-full"
              />
            </div>

            <Separator />

            {/* Note types */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Note Types
              </h3>
              <div className="space-y-1">
                {ALL_NOTE_TYPES.map((type) => (
                  <button
                    key={type}
                    onClick={() => toggleNoteType(type)}
                    className={`flex items-center gap-2 w-full px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                      filters.noteTypes.has(type) ? "text-foreground" : "text-muted-foreground/40"
                    }`}
                  >
                    <div
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{
                        background: TYPE_COLORS[type],
                        opacity: filters.noteTypes.has(type) ? 1 : 0.3,
                      }}
                    />
                    <span className="capitalize">{type.replace("_", " ")}</span>
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Display options */}
            <div>
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Display
              </h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={filters.showOrphans}
                    onCheckedChange={(v) => setFilters((f) => ({ ...f, showOrphans: v }))}
                    className="scale-75"
                  />
                  <Label className="text-[11px]">Show orphan notes</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={filters.sizeMode === "connections"}
                    onCheckedChange={(v) =>
                      setFilters((f) => ({ ...f, sizeMode: v ? "connections" : "uniform" }))
                    }
                    className="scale-75"
                  />
                  <Label className="text-[11px]">Size by connections</Label>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Labels</Label>
                  <div className="flex gap-1">
                    {(["hover", "always", "never"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setFilters((f) => ({ ...f, labelMode: mode }))}
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                          filters.labelMode === mode
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Graph canvas */}
        <div ref={containerRef} className="flex-1 min-w-0 bg-card relative">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Building graph…
            </div>
          ) : processedGraph.nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <FileText className="h-8 w-8" />
              <p className="text-sm">No nodes to display.</p>
              <p className="text-xs">Create notes and let the AI find connections.</p>
            </div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={processedGraph}
              width={dimensions.width - (showFilters ? 224 : 0) - (selectedNode ? 288 : 0)}
              height={dimensions.height}
              nodeCanvasObject={nodeCanvasObject}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                const size = getNodeSize(node) + 4;
                ctx.beginPath();
                ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkCanvasObjectMode={() => "replace"}
              linkCanvasObject={linkCanvasObject}
              onNodeClick={handleNodeClick}
              onNodeHover={(node: any) => setHoveredNode(node?.id || null)}
              onNodeDragEnd={(node: any) => {
                node.fx = node.x;
                node.fy = node.y;
              }}
              onBackgroundClick={() => setSelectedNode(null)}
              cooldownTicks={120}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              enableNodeDrag
              enableZoomInteraction
              enablePanInteraction
            />
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="w-72 shrink-0 border-l border-border bg-background overflow-y-auto">
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground leading-tight">
                  {selectedNode.title || "Untitled"}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => setSelectedNode(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant="secondary"
                  className="text-[10px] capitalize"
                  style={{ borderColor: getNodeColor(selectedNode) }}
                >
                  {(selectedNode.type || "note").replace("_", " ")}
                </Badge>
                {selectedNode.tags?.map((t) => (
                  <Badge key={t} variant="outline" className="text-[9px] px-1.5 py-0">
                    {t}
                  </Badge>
                ))}
              </div>

              {selectedNode.topics && selectedNode.topics.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedNode.topics.map((t) => (
                    <Badge key={t} variant="outline" className="text-[9px] px-1 py-0 bg-primary/5">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              <Separator />

              {/* Connection summary */}
              <div>
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Connections ({selectedNodeEdges.length})
                </h3>
                {["manual_link", "semantic", "shared_person", "shared_topic"].map((type) => {
                  const ofType = selectedNodeEdges.filter((e) => e.type === type);
                  if (ofType.length === 0) return null;
                  return (
                    <div key={type} className="mb-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div
                          className="h-2 w-2 rounded-full"
                          style={{ background: EDGE_STYLES[type]?.color }}
                        />
                        <span className="text-[10px] text-muted-foreground capitalize">
                          {type.replace("_", " ")} ({ofType.length})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Connected notes list */}
              {selectedNeighborNodes.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Connected Notes
                  </h3>
                  <div className="space-y-1">
                    {selectedNeighborNodes.slice(0, 15).map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setSelectedNode(n as ForceNode)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-muted/50 transition-colors group"
                      >
                        <div
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: getNodeColor(n as ForceNode) }}
                        />
                        <span className="truncate flex-1">{n.title || "Untitled"}</span>
                        <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  className="w-full text-xs gap-1.5"
                  onClick={() => navigate(`/dashboard/notes/${selectedNode.id}`)}
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Note
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs gap-1.5"
                  onClick={() =>
                    navigate(`/dashboard/notes/${selectedNode.id}`)
                  }
                >
                  <Sparkles className="h-3 w-3" />
                  Find Connections
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-muted/20 text-[10px] text-muted-foreground shrink-0 overflow-x-auto">
        <span className="font-semibold uppercase tracking-wider shrink-0">Nodes:</span>
        {ALL_NOTE_TYPES.slice(0, 6).map((type) => (
          <div key={type} className="flex items-center gap-1 shrink-0">
            <div className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[type] }} />
            <span className="capitalize">{type.replace("_", " ")}</span>
          </div>
        ))}
        <span className="mx-2">|</span>
        <span className="font-semibold uppercase tracking-wider shrink-0">Edges:</span>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-4 border-t-2 border-solid" style={{ borderColor: EDGE_STYLES.manual_link.color }} />
          <span>Manual</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-4 border-t-2 border-dotted" style={{ borderColor: EDGE_STYLES.semantic.color }} />
          <span>Semantic</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-4 border-t-2 border-dashed" style={{ borderColor: EDGE_STYLES.shared_person.color }} />
          <span>Person</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="w-4 border-t-2 border-dashed" style={{ borderColor: EDGE_STYLES.shared_topic.color }} />
          <span>Topic</span>
        </div>
      </div>
    </div>
  );
}

function adjustAlpha(hslColor: string, alpha: number): string {
  // Convert "hsl(h, s%, l%)" to "hsla(h, s%, l%, alpha)"
  return hslColor.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
}
