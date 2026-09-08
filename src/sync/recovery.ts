import { createStore, get, set } from "idb-keyval";
import type { CrudEntry } from "@powersync/web";

export type FailureKind = "data" | "permission" | "schema" | "auth" | "transient";
export interface RecoveryBatch {
  id: string;
  operations: CrudEntry[];
  completed: number;
  status: "uploading" | "recovery";
  kind?: FailureKind;
  code?: string;
  createdAt: string;
}
const store = createStore("menerio-upload-recovery", "accounts");
export async function readRecovery(userId: string): Promise<RecoveryBatch[]> {
  return (await get<RecoveryBatch[]>(userId, store)) ?? [];
}
export async function writeRecovery(userId: string, batches: RecoveryBatch[]) {
  // Await the IndexedDB transaction commit before acknowledging PowerSync.
  await set(userId, batches, store);
  window.dispatchEvent(new Event("menerio-recovery-change"));
}

export async function withRecoveryLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
  // A per-tab mutex cannot protect the shared IndexedDB journal. Without the
  // browser lock, retain PowerSync's edits instead of risking a lost update.
  if (!navigator.locks) throw new Error("This browser cannot safely upload saved changes. Use a browser with Web Locks support.");
  return await navigator.locks.request(`menerio-recovery:${userId}`, work);
}

/** Make in-flight work retryable before its PowerSync transaction is cleared. */
export async function preserveUploadsBeforeAccountClear(userId: string): Promise<void> {
  await withRecoveryLock(userId, async () => {
    const batches = await readRecovery(userId);
    await writeRecovery(userId, batches
      .filter(batch => batch.completed < batch.operations.length)
      .map(batch => batch.status === "uploading"
        ? { ...batch, status: "recovery" as const, kind: "transient" as const }
        : batch));
  });
}

// Conservative dependency closure: same row, or any referenced row ID, including
// IDs embedded in JSON columns. Unknown future tables share the whole transaction.
export function dependentGroups(operations: CrudEntry[]): CrudEntry[][] {
  if (operations.some(op => op.table !== "notes")) return [operations];
  const groups: CrudEntry[][] = [];
  for (const operation of operations) {
    const related = groups.filter(group => group.some(other =>
      other.id === operation.id || references(other.opData, operation.id)
      || references(operation.opData, other.id)));
    const members = new Set([...related.flat(), operation]);
    for (const group of related) groups.splice(groups.indexOf(group), 1);
    groups.push(operations.filter(op => members.has(op)));
  }
  return groups;
}

function references(value: unknown, id: string): boolean {
  if (typeof value === "string") {
    if (value === id || (id.length >= 32 && value.includes(id))) return true;
    if (value.startsWith("[") || value.startsWith("{")) {
      try { return references(JSON.parse(value), id); } catch { return false; }
    }
    return false;
  }
  if (value && typeof value === "object") return Object.values(value).some(child => references(child, id));
  return false;
}
