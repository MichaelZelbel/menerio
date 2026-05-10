import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseBulkSelectResult {
  selected: Set<string>;
  size: number;
  isSelected: (id: string) => boolean;
  clear: () => void;
  /**
   * Returns true if the click was consumed by multi-select handling
   * (caller should NOT navigate / select-single).
   */
  handleClick: (e: React.MouseEvent, id: string) => boolean;
}

/**
 * Cmd/Ctrl+Click toggles a single id; Shift+Click selects the inclusive range
 * between the last anchor and the clicked id; plain clicks clear selection
 * but tell the caller to proceed with normal navigation.
 */
export function useBulkSelect(orderedIds: string[]): UseBulkSelectResult {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  const idIndex = useMemo(() => {
    const m = new Map<string, number>();
    orderedIds.forEach((id, i) => m.set(id, i));
    return m;
  }, [orderedIds]);

  // Drop selections for ids that no longer exist.
  useEffect(() => {
    if (selected.size === 0) return;
    let changed = false;
    const next = new Set<string>();
    selected.forEach((id) => {
      if (idIndex.has(id)) next.add(id);
      else changed = true;
    });
    if (changed) setSelected(next);
  }, [idIndex, selected]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const handleClick = useCallback(
    (e: React.MouseEvent, id: string): boolean => {
      const isMod = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      if (isMod) {
        e.preventDefault();
        e.stopPropagation();
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchorRef.current = id;
        return true;
      }

      if (isShift) {
        e.preventDefault();
        e.stopPropagation();
        const anchor = anchorRef.current;
        if (!anchor || anchor === id || !idIndex.has(anchor)) {
          // No usable anchor — treat the clicked row as the anchor selection.
          setSelected((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
          anchorRef.current = id;
          return true;
        }
        const a = idIndex.get(anchor)!;
        const b = idIndex.get(id)!;
        const [start, end] = a < b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(orderedIds[i]);
          return next;
        });
        return true;
      }

      // Plain click — clear any selection, let caller handle navigation.
      if (selected.size > 0) setSelected(new Set());
      anchorRef.current = id;
      return false;
    },
    [idIndex, orderedIds, selected.size]
  );

  return {
    selected,
    size: selected.size,
    isSelected: (id) => selected.has(id),
    clear,
    handleClick,
  };
}
