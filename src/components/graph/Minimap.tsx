import { useEffect, useRef } from "react";

interface Node {
  id: string;
  x?: number;
  y?: number;
  type?: string;
}

interface MinimapProps {
  nodes: Node[];
  getColor: (n: Node) => string;
  width?: number;
  height?: number;
  /** Returns current viewport center+zoom + canvas size from ForceGraph2D. */
  getViewport: () => { cx: number; cy: number; zoom: number; w: number; h: number } | null;
  onPan: (worldX: number, worldY: number) => void;
}

/**
 * Lightweight overview map. Renders all nodes as 1.5px dots in their
 * type colors and overlays the current viewport rectangle. Click to recenter.
 */
export function Minimap({
  nodes,
  getColor,
  width = 160,
  height = 110,
  getViewport,
  onPan,
}: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Compute bounds
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
      if (!isFinite(minX)) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const pad = 30;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      boundsRef.current = { minX, minY, maxX, maxY };

      const dx = maxX - minX || 1;
      const dy = maxY - minY || 1;
      const scale = Math.min(width / dx, height / dy);
      const offsetX = (width - dx * scale) / 2;
      const offsetY = (height - dy * scale) / 2;

      const toMx = (wx: number) => offsetX + (wx - minX) * scale;
      const toMy = (wy: number) => offsetY + (wy - minY) * scale;

      // Subtle background
      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.fillRect(0, 0, width, height);

      // Nodes
      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue;
        ctx.fillStyle = getColor(n);
        ctx.fillRect(toMx(n.x) - 1, toMy(n.y) - 1, 2, 2);
      }

      // Viewport rect
      const vp = getViewport();
      if (vp && vp.zoom > 0) {
        const viewW = vp.w / vp.zoom;
        const viewH = vp.h / vp.zoom;
        const rx = toMx(vp.cx - viewW / 2);
        const ry = toMy(vp.cy - viewH / 2);
        const rw = viewW * scale;
        const rh = viewH * scale;
        ctx.strokeStyle = "hsla(220, 70%, 70%, 0.85)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [nodes, getColor, width, height, getViewport]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const b = boundsRef.current;
    if (!b) return;
    const dx = b.maxX - b.minX || 1;
    const dy = b.maxY - b.minY || 1;
    const scale = Math.min(width / dx, height / dy);
    const offsetX = (width - dx * scale) / 2;
    const offsetY = (height - dy * scale) / 2;
    const wx = b.minX + (mx - offsetX) / scale;
    const wy = b.minY + (my - offsetY) / scale;
    onPan(wx, wy);
  };

  return (
    <div className="absolute bottom-3 right-3 z-10 rounded-md border border-border bg-background/80 backdrop-blur-sm shadow-md overflow-hidden">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleClick}
        style={{ width, height, display: "block", cursor: "pointer" }}
        aria-label="Graph minimap"
      />
      <div className="absolute top-1 left-2 text-[9px] uppercase tracking-wider text-muted-foreground pointer-events-none">
        Overview
      </div>
    </div>
  );
}
