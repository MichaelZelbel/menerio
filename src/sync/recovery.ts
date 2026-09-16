import { createStore, get, set } from "idb-keyval";
import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";

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

/**
 * Journal identity of a dependent group of operations. clientId is stable
 * across retries; the payload avoids collisions after a local database reset
 * under the same account. uploadData and the account-clear drain must agree.
 */
export function recoveryBatchId(operations: CrudEntry[]): string {
  return JSON.stringify(operations.map(op => [op.clientId, op.table, op.id, op.op, op.opData]));
}

/**
 * Make pending work retryable before PowerSync's local database is cleared.
 *
 * Two kinds of work would otherwise be lost on sign-out or an account switch:
 * batches uploadData had started (already journaled, marked "uploading"), and
 * transactions still waiting in PowerSync's upload queue that uploadData never
 * picked up, typically edits made offline. Both are kept in the journal as
 * "recovery" batches, which the recovery notice offers to retry once the same
 * account signs in again.
 */
export async function preserveUploadsBeforeAccountClear(
  userId: string,
  database?: Pick<AbstractPowerSyncDatabase, "getCrudTransactions">,
): Promise<void> {
  await withRecoveryLock(userId, async () => {
    const batches = await readRecovery(userId);
    // Checked against the unfiltered journal, so a group that already finished
    // uploading is not queued to be sent a second time.
    const known = new Set(batches.map(batch => batch.id));
    const queued: RecoveryBatch[] = [];
    if (database) {
      for await (const transaction of database.getCrudTransactions()) {
        for (const operations of dependentGroups(transaction.crud)) {
          const id = recoveryBatchId(operations);
          if (known.has(id)) continue;
          known.add(id);
          queued.push({ id, operations, completed: 0, status: "recovery", kind: "transient", createdAt: new Date().toISOString() });
        }
      }
    }
    await writeRecovery(userId, [
      ...batches
        .filter(batch => batch.completed < batch.operations.length)
        .map(batch => batch.status === "uploading"
          ? { ...batch, status: "recovery" as const, kind: "transient" as const }
          : batch),
      ...queued,
    ]);
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
