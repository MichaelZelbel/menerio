import { useCallback, useEffect, useState } from "react";

export type PanelPrefKey = "note-metadata" | "note-links" | "note-backlinks";

const STORAGE_PREFIX = "menerio.panelPrefs.";
const EVENT_NAME = "menerio:panel-pref-change";

function storageKey(key: PanelPrefKey) {
  return `${STORAGE_PREFIX}${key}`;
}

function readPref(key: PanelPrefKey): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw == null) return false;
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

/**
 * Sticky per-panel expand/collapse preference, persisted in localStorage.
 * Defaults to `false` (collapsed) when the user has never touched the panel.
 * Once the user toggles it, the choice is remembered across notes and reloads.
 */
export function useStickyPanelPreference(
  key: PanelPrefKey,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => readPref(key));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = (e: Event) => {
      // Sync between instances in the same tab and across tabs.
      if (e instanceof StorageEvent) {
        if (e.key !== storageKey(key)) return;
      } else if (e instanceof CustomEvent) {
        if ((e as CustomEvent<{ key: string }>).detail?.key !== key) return;
      }
      setValue(readPref(key));
    };
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT_NAME, sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT_NAME, sync as EventListener);
    };
  }, [key]);

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey(key), JSON.stringify(next));
        window.dispatchEvent(
          new CustomEvent(EVENT_NAME, { detail: { key } }),
        );
      } catch {
        // Ignore write failures (private mode, quota, etc.).
      }
    },
    [key],
  );

  return [value, update];
}
