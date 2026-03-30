import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGraphData, GraphNode, GraphEdge } from "@/hooks/useGraphData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Star, Layers, FileText, ArrowRight } from "lucide-react";

/** Compute betweenness centrality approximation via BFS from each node */
function computeBetweenness(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }

  const bc = new Map<string, number>();
  for (const n of nodes) bc.set(n.id, 0);

  // BFS-based betweenness (Brandes algorithm simplified)
  for (const s of nodes) {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    const delta = new Map<string, number>();

    for (const n of nodes) {
      pred.set(n.id, []);
      sigma.set(n.id, 0);
      dist.set(n.id, -1);
      delta.set(n.id, 0);
    }

    sigma.set(s.id, 1);
    dist.set(s.id, 0);
    const queue = [s.id];

    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      for (const w of adj.get(v) || []) {
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }

    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s.id) {
        bc.set(w, bc.get(w)! + delta.get(w)!);
      }
    }
  }

  return bc;
}

/** Simple community detection using label propagation */
function detectClusters(nodes: GraphNode[], edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }

  // Label each node with its own ID initially
  const labels = new Map<string, string>();
  for (const n of nodes) labels.set(n.id, n.id);

  // Iterate label propagation
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    const shuffled = [...nodes].sort(() => Math.random() - 0.5);
    for (const n of shuffled) {
      const neighbors = adj.get(n.id) || [];
      if (neighbors.length === 0) continue;
      const freq = new Map<string, number>();
      for (const nb of neighbors) {
        const l = labels.get(nb)!;
        freq.set(l, (freq.get(l) || 0) + 1);
      }
      let maxLabel = labels.get(n.id)!;
      let maxCount = 0;
      for (const [l, c] of freq) {
        if (c > maxCount) { maxCount = c; maxLabel = l; }
      }
      if (maxLabel !== labels.get(n.id)) {
        labels.set(n.id, maxLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group by label
  const clusters = new Map<string, string[]>();
  for (const [nodeId, label] of labels) {
    if (!clusters.has(label)) clusters.set(label, []);
    clusters.get(label)!.push(nodeId);
  }

  return clusters;
}

interface BridgeNotesHighlighterProps {
  compact?: boolean;
}

export function BridgeNotesHighlighter({ compact }: BridgeNotesHighlighterProps) {
  const navigate = useNavigate();
  const { data: graphData } = useGraphData({ limit: 500 });

  const bridgeNotes = useMemo(() => {
    if (!graphData || graphData.nodes.length < 3) return [];
    const bc = computeBetweenness(graphData.nodes, graphData.edges);
    return [...bc.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, compact ? 5 : 15)
      .map(([id, score]) => ({
        node: graphData.nodes.find((n) => n.id === id)!,
        score,
      }))
      .filter((b) => b.node);
  }, [graphData, compact]);

  if (bridgeNotes.length === 0) return null;

  const maxScore = bridgeNotes[0]?.score || 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-1.5">
          <Star className="h-4 w-4 text-warning" />
          Key Connections
        </CardTitle>
        <Badge variant="secondary" className="text-xs">
          {bridgeNotes.length}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Notes that bridge different areas of your knowledge.
        </p>
        <div className="space-y-1.5">
          {bridgeNotes.map(({ node, score }) => (
            <button
              key={node.id}
              onClick={() => navigate(`/dashboard/notes/${node.id}`)}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-xs group"
            >
              <Star className="h-3 w-3 text-warning shrink-0" />
              <span className="truncate flex-1 font-medium">{node.title || "Untitled"}</span>
              <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden shrink-0">
                <div
                  className="h-full rounded-full bg-warning"
                  style={{ width: `${(score / maxScore) * 100}%` }}
                />
              </div>
              <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface TopicClustersViewProps {
  onFilterCluster?: (noteIds: string[]) => void;
}

export function TopicClustersView({ onFilterCluster }: TopicClustersViewProps) {
  const navigate = useNavigate();
  const { data: graphData } = useGraphData({ limit: 500 });

  const clusters = useMemo(() => {
    if (!graphData || graphData.nodes.length < 3) return [];
    const raw = detectClusters(graphData.nodes, graphData.edges);
    const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));

    return [...raw.entries()]
      .filter(([, ids]) => ids.length >= 2)
      .map(([, ids]) => {
        const clusterNodes = ids.map((id) => nodeMap.get(id)!).filter(Boolean);
        // Derive cluster name from most common topics
        const topicCounts = new Map<string, number>();
        for (const n of clusterNodes) {
          for (const t of n.topics || []) {
            topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
          }
        }
        const topTopics = [...topicCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t);
        const label = topTopics.length > 0 ? topTopics.join(" & ") : "Unnamed Cluster";
        return { label, nodes: clusterNodes, noteIds: ids };
      })
      .sort((a, b) => b.nodes.length - a.nodes.length);
  }, [graphData]);

  if (clusters.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-primary" />
          Topic Clusters
        </CardTitle>
        <Badge variant="secondary" className="text-xs">
          {clusters.length}
        </Badge>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2">
            {clusters.map((cluster, idx) => (
              <div key={idx}>
                <button
                  onClick={() => onFilterCluster?.(cluster.noteIds)}
                  className="w-full text-left flex items-center gap-2 px-2 py-2 rounded-md hover:bg-accent transition-colors group"
                >
                  <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium block truncate">
                      {cluster.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {cluster.nodes.length} notes
                    </span>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
                {idx < clusters.length - 1 && <Separator className="mt-1" />}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

/** Bridge note IDs for highlighting in the global graph */
export function useBridgeNoteIds(): Set<string> {
  const { data: graphData } = useGraphData({ limit: 500 });
  return useMemo(() => {
    if (!graphData || graphData.nodes.length < 3) return new Set<string>();
    const bc = computeBetweenness(graphData.nodes, graphData.edges);
    const sorted = [...bc.entries()].sort((a, b) => b[1] - a[1]);
    const threshold = sorted.length > 0 ? sorted[0][1] * 0.3 : 0;
    return new Set(sorted.filter(([, v]) => v > threshold).map(([id]) => id));
  }, [graphData]);
}
