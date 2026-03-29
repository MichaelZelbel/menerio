import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Loader2, Search, FileText, UserCircle, X, Maximize2, Minimize2 } from "lucide-react";
import ForceGraph2D from "react-force-graph-2d";

interface GraphNode {
  id: string;
  name: string;
  type: "note" | "contact" | "topic";
  color: string;
  val: number; // node size
  metadata?: Record<string, unknown>;
}

interface GraphLink {
  source: string;
  target: string;
  label?: string;
  value: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const TYPE_COLORS: Record<string, string> = {
  observation: "hsl(220, 70%, 50%)",
  task: "hsl(38, 92%, 50%)",
  idea: "hsl(280, 60%, 55%)",
  reference: "hsl(152, 60%, 40%)",
  person_note: "hsl(340, 60%, 50%)",
  meeting_note: "hsl(205, 78%, 50%)",
  decision: "hsl(0, 72%, 51%)",
  project: "hsl(160, 60%, 45%)",
  contact: "hsl(270, 60%, 55%)",
  topic: "hsl(38, 80%, 55%)",
  default: "hsl(220, 14%, 60%)",
};

export default function KnowledgeGraph() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [fullscreen, setFullscreen] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  // Measure container
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width || 800,
          height: fullscreen ? window.innerHeight - 60 : Math.max(rect.height, 500),
        });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  // Build graph from notes + contacts
  const buildGraph = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [notesRes, contactsRes] = await Promise.all([
      supabase
        .from("notes")
        .select("id, title, metadata, tags, created_at")
        .eq("user_id", user.id)
        .eq("is_trashed", false)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("contacts")
        .select("id, name, relationship")
        .eq("user_id", user.id),
    ]);

    const notes = notesRes.data || [];
    const contacts = contactsRes.data || [];

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const topicMap = new Map<string, string[]>(); // topic -> note IDs
    const peopleMap = new Map<string, string[]>(); // person name -> note IDs

    // Add note nodes
    for (const note of notes) {
      const meta = (note.metadata || {}) as Record<string, unknown>;
      const noteType = (meta.type as string) || "default";
      const color = TYPE_COLORS[noteType] || TYPE_COLORS.default;

      nodes.push({
        id: note.id,
        name: note.title || "Untitled",
        type: "note",
        color,
        val: 1,
        metadata: meta,
      });

      // Track topics
      const topics = (Array.isArray(meta.topics) ? meta.topics : note.tags || []) as string[];
      for (const topic of topics) {
        const key = topic.toLowerCase();
        if (!topicMap.has(key)) topicMap.set(key, []);
        topicMap.get(key)!.push(note.id);
      }

      // Track people
      if (Array.isArray(meta.people)) {
        for (const person of meta.people as string[]) {
          const key = person.toLowerCase();
          if (!peopleMap.has(key)) peopleMap.set(key, []);
          peopleMap.get(key)!.push(note.id);
        }
      }
    }

    // Add contact nodes
    for (const contact of contacts) {
      nodes.push({
        id: `contact-${contact.id}`,
        name: contact.name,
        type: "contact",
        color: TYPE_COLORS.contact,
        val: 2,
      });

      // Link contacts to notes that mention them
      const key = contact.name.toLowerCase();
      if (peopleMap.has(key)) {
        for (const noteId of peopleMap.get(key)!) {
          links.push({
            source: `contact-${contact.id}`,
            target: noteId,
            label: "mentioned",
            value: 1,
          });
        }
      }
    }

    // Link notes that share topics (only for topics with 2+ notes, max connections)
    for (const [topic, noteIds] of topicMap) {
      if (noteIds.length < 2 || noteIds.length > 20) continue;
      // Only connect pairs up to a limit
      for (let i = 0; i < Math.min(noteIds.length, 5); i++) {
        for (let j = i + 1; j < Math.min(noteIds.length, 5); j++) {
          links.push({
            source: noteIds[i],
            target: noteIds[j],
            label: topic,
            value: 0.5,
          });
        }
      }
    }

    // Calculate connectivity for node sizing
    const connectivity = new Map<string, number>();
    for (const link of links) {
      const s = typeof link.source === "string" ? link.source : (link.source as unknown as GraphNode).id;
      const t = typeof link.target === "string" ? link.target : (link.target as unknown as GraphNode).id;
      connectivity.set(s, (connectivity.get(s) || 0) + 1);
      connectivity.set(t, (connectivity.get(t) || 0) + 1);
    }
    for (const node of nodes) {
      node.val = Math.max(1, Math.min(8, (connectivity.get(node.id) || 0) + 1));
    }

    setGraphData({ nodes, links });
    setLoading(false);
  }, [user]);

  useEffect(() => { buildGraph(); }, [buildGraph]);

  // Filtered graph
  const filteredGraph = useMemo(() => {
    let filteredNodes = graphData.nodes;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filteredNodes = filteredNodes.filter((n) => n.name.toLowerCase().includes(term));
    }

    if (typeFilter !== "all") {
      filteredNodes = filteredNodes.filter((n) => {
        if (typeFilter === "contact") return n.type === "contact";
        const meta = n.metadata;
        return meta && (meta.type as string) === typeFilter;
      });
    }

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = graphData.links.filter((l) => {
      const s = typeof l.source === "string" ? l.source : (l.source as unknown as GraphNode).id;
      const t = typeof l.target === "string" ? l.target : (l.target as unknown as GraphNode).id;
      return nodeIds.has(s) && nodeIds.has(t);
    });

    return { nodes: filteredNodes, links: filteredLinks };
  }, [graphData, searchTerm, typeFilter]);

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node);
  };

  return (
    <div className={fullscreen ? "fixed inset-0 z-50 bg-background" : ""}>
      <SEOHead title="Knowledge Graph — Menerio" noIndex />

      <div className="flex items-center justify-between mb-4 px-2">
        <div>
          <h1 className="text-2xl font-display font-bold">Knowledge Graph</h1>
          <p className="text-sm text-muted-foreground">
            {graphData.nodes.length} nodes · {graphData.links.length} connections
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 px-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter nodes…"
            className="pl-8 h-8 text-xs"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="contact">Contacts</SelectItem>
            <SelectItem value="observation">Observations</SelectItem>
            <SelectItem value="task">Tasks</SelectItem>
            <SelectItem value="idea">Ideas</SelectItem>
            <SelectItem value="reference">References</SelectItem>
            <SelectItem value="decision">Decisions</SelectItem>
            <SelectItem value="project">Projects</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-4">
        {/* Graph */}
        <div
          ref={containerRef}
          className="flex-1 rounded-lg border bg-card overflow-hidden"
          style={{ minHeight: fullscreen ? "calc(100vh - 120px)" : 500 }}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Building graph…
            </div>
          ) : filteredGraph.nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <p className="text-sm">No nodes to display. Create some notes first.</p>
            </div>
          ) : (
            <ForceGraph2D
              graphData={filteredGraph}
              width={dimensions.width}
              height={dimensions.height}
              nodeLabel={(node: GraphNode) => node.name}
              nodeColor={(node: GraphNode) => node.color}
              nodeRelSize={5}
              nodeVal={(node: GraphNode) => node.val}
              linkColor={() => "hsla(220, 14%, 50%, 0.15)"}
              linkWidth={1}
              onNodeClick={(node) => handleNodeClick(node as unknown as GraphNode)}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const label = node.name as string;
                const fontSize = Math.max(10 / globalScale, 2);
                const nodeSize = Math.sqrt(node.val || 1) * 5;

                // Draw node
                ctx.beginPath();
                if (node.type === "contact") {
                  // Diamond for contacts
                  ctx.moveTo(node.x, node.y - nodeSize);
                  ctx.lineTo(node.x + nodeSize, node.y);
                  ctx.lineTo(node.x, node.y + nodeSize);
                  ctx.lineTo(node.x - nodeSize, node.y);
                } else {
                  ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
                }
                ctx.fillStyle = node.color;
                ctx.fill();

                // Draw label if zoomed enough
                if (globalScale > 1.5) {
                  ctx.font = `${fontSize}px Inter, sans-serif`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "top";
                  ctx.fillStyle = "hsl(220, 25%, 30%)";
                  const truncated = label.length > 25 ? label.slice(0, 22) + "…" : label;
                  ctx.fillText(truncated, node.x, node.y + nodeSize + 2);
                }
              }}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                const nodeSize = Math.sqrt(node.val || 1) * 5 + 4;
                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
            />
          )}
        </div>

        {/* Detail sidebar */}
        {selectedNode && (
          <Card className="w-72 shrink-0 self-start">
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <CardTitle className="text-sm truncate flex-1">{selectedNode.name}</CardTitle>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setSelectedNode(null)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                {selectedNode.type === "contact" ? (
                  <UserCircle className="h-4 w-4 text-info" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <Badge variant="outline" className="text-xs capitalize">{selectedNode.type}</Badge>
                {selectedNode.metadata?.type && (
                  <Badge variant="secondary" className="text-xs capitalize">
                    {selectedNode.metadata.type as string}
                  </Badge>
                )}
              </div>

              {selectedNode.metadata?.topics && (
                <div className="flex flex-wrap gap-1">
                  {(selectedNode.metadata.topics as string[]).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}

              {selectedNode.metadata?.summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {selectedNode.metadata.summary as string}
                </p>
              )}

              <Separator />

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Connections: {filteredGraph.links.filter((l) => {
                    const s = typeof l.source === "string" ? l.source : (l.source as unknown as GraphNode).id;
                    const t = typeof l.target === "string" ? l.target : (l.target as unknown as GraphNode).id;
                    return s === selectedNode.id || t === selectedNode.id;
                  }).length}
                </span>
              </div>

              <Button
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  if (selectedNode.type === "contact") {
                    navigate("/dashboard/people");
                  } else {
                    navigate(`/dashboard/notes?selected=${selectedNode.id}`);
                  }
                }}
              >
                Open {selectedNode.type === "contact" ? "Contact" : "Note"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-4 px-2 text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider">Legend:</span>
        {Object.entries(TYPE_COLORS)
          .filter(([k]) => k !== "default")
          .slice(0, 8)
          .map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <div className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              <span className="capitalize">{type.replace("_", " ")}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
