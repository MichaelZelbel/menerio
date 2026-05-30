/**
 * Rendering helpers for the Note Graph.
 *
 * Implements the semantic-zoom model:
 *  - Nodes render at constant screen size (radius / zoom).
 *  - Labels gated by a 3-tier Level-of-Detail system.
 *  - Greedy collision avoidance via a per-frame rect buffer.
 *  - Cluster hulls collapse dense areas at very low zoom.
 */

export type LabelTier = 0 | 1 | 2;

export interface RenderNode {
  id: string;
  x?: number;
  y?: number;
  title: string;
  type: string;
  topics?: string[];
  __connectionCount?: number;
  __tier?: LabelTier;
  __importance?: number;
}

/** Connection-count percentile → tier. Top 10 % = Tier 0, top 40 % = Tier 1. */
export function assignTiers(nodes: RenderNode[]) {
  if (nodes.length === 0) return;
  const counts = nodes.map((n) => n.__connectionCount || 0);
  const sorted = [...counts].sort((a, b) => b - a);
  const t0Cut = sorted[Math.max(0, Math.floor(sorted.length * 0.1) - 1)] ?? 0;
  const t1Cut = sorted[Math.max(0, Math.floor(sorted.length * 0.4) - 1)] ?? 0;
  const maxCount = sorted[0] || 1;
  for (const n of nodes) {
    const c = n.__connectionCount || 0;
    // Person nodes always promoted to Tier 0
    const isPerson = n.id.startsWith("contact:") || n.id.startsWith("person:") || n.type === "person_note";
    if (isPerson || c >= t0Cut) n.__tier = 0;
    else if (c >= t1Cut) n.__tier = 1;
    else n.__tier = 2;
    n.__importance = Math.log(1 + c) / Math.log(1 + maxCount);
  }
}

/** Should a node's label be drawn at this zoom level (auto mode)? */
export function shouldShowLabelAuto(tier: LabelTier, zoom: number): boolean {
  if (tier === 0) return zoom >= 0.25;
  if (tier === 1) return zoom >= 0.8;
  return zoom >= 1.4;
}

/** Screen-pixel radius for a node, based on importance. */
export function nodeScreenRadius(importance: number, mode: "importance" | "uniform"): number {
  if (mode === "uniform") return 7;
  // 6 px baseline + up to 8 px for the most-connected.
  return 6 + importance * 8;
}

/** Font size in screen pixels, scaling gently with zoom. */
export function labelFontPx(zoom: number, tier: LabelTier): number {
  const base = tier === 0 ? 12 : 11;
  // Linear from base at zoom=1 to base+3 at zoom=2.5+
  const bonus = Math.max(0, Math.min(3, (zoom - 1) * 2));
  return base + bonus;
}

/** Wrap a title onto up to N lines of approx maxChars width. */
export function wrapTitle(title: string, maxChars: number, maxLines: number): string[] {
  if (!title) return [""];
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; if (lines.length >= maxLines - 1) break; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  // If the last line was a single very long word, truncate it
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (last.length > maxChars) lines[maxLines - 1] = last.slice(0, maxChars - 1) + "…";
  }
  // If original title had more words we couldn't fit, append ellipsis
  const consumed = lines.join(" ").length;
  if (consumed < title.length - 2 && !lines[lines.length - 1].endsWith("…")) {
    const last = lines[lines.length - 1];
    if (last.length + 1 <= maxChars) lines[lines.length - 1] = last + "…";
    else lines[lines.length - 1] = last.slice(0, Math.max(0, maxChars - 1)) + "…";
  }
  return lines;
}

export interface Rect { x: number; y: number; w: number; h: number; }

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/** Cluster nodes that share their dominant topic, for the low-zoom overview. */
export interface Cluster {
  key: string;
  label: string;
  count: number;
  cx: number;
  cy: number;
  radius: number;
  color: string;
}

const TOPIC_COLORS = [
  "hsl(220, 70%, 55%)",
  "hsl(270, 55%, 55%)",
  "hsl(38, 92%, 50%)",
  "hsl(175, 60%, 45%)",
  "hsl(340, 60%, 55%)",
  "hsl(152, 60%, 45%)",
  "hsl(15, 70%, 55%)",
  "hsl(205, 78%, 50%)",
];

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return TOPIC_COLORS[Math.abs(h) % TOPIC_COLORS.length];
}

export function computeClusters(nodes: RenderNode[], minSize = 4): Cluster[] {
  const groups = new Map<string, RenderNode[]>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const topic = n.topics?.[0]?.toLowerCase().trim();
    if (!topic) continue;
    const arr = groups.get(topic) || [];
    arr.push(n);
    groups.set(topic, arr);
  }
  const out: Cluster[] = [];
  for (const [key, arr] of groups) {
    if (arr.length < minSize) continue;
    let sx = 0, sy = 0;
    for (const n of arr) { sx += n.x!; sy += n.y!; }
    const cx = sx / arr.length;
    const cy = sy / arr.length;
    let maxR = 0;
    for (const n of arr) {
      const d = Math.hypot(n.x! - cx, n.y! - cy);
      if (d > maxR) maxR = d;
    }
    out.push({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      count: arr.length,
      cx, cy,
      radius: Math.max(maxR + 20, 40),
      color: colorFor(key),
    });
  }
  // Largest clusters first so they're drawn behind smaller ones
  out.sort((a, b) => b.count - a.count);
  return out;
}
