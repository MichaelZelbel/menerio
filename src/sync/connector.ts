import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/web";
import { supabase } from "@/integrations/supabase/client";
import { captureNoteWithLexicon } from "@/lib/note-ai-enrollment";
import { POWERSYNC_URL } from "./config";
import { dependentGroups, readRecovery, writeRecovery, withRecoveryLock, type FailureKind, type RecoveryBatch } from "./recovery";

// Columns stored as JSON text in SQLite that must be real JSON/arrays in Postgres.
const JSON_COLUMNS: Record<string, string[]> = {
  notes: ["metadata", "tags", "structured_fields", "related"],
};

// Columns stored as 0/1 in SQLite that must be booleans in Postgres.
const BOOLEAN_COLUMNS: Record<string, string[]> = {
  notes: ["is_favorite", "is_pinned", "is_trashed", "is_external"],
};

// The notes_updated_at trigger (moddatetime) owns updated_at server-side;
// never send the device's value upstream.
const SERVER_OWNED_COLUMNS: Record<string, string[]> = {
  notes: ["updated_at"],
};

/**
 * A local value that can never be accepted upstream, however many times we try.
 *
 * isFatalError classifies by Postgres SQLSTATE, which a client-side parse
 * failure does not have — so an unparseable JSON column was rethrown as
 * retryable and PowerSync replayed the same transaction forever, with every
 * later edit stuck behind it. That is the exact permanent wedge FATAL_CODES
 * exists to prevent; it just could not see this class of error.
 */
export class FatalSyncError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "FatalSyncError";
  }
}

function parseJsonColumn(table: string, key: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new FatalSyncError(`malformed JSON in ${table}.${key}`, error);
  }
}

function toPostgresRecord(
  table: string,
  opData: Record<string, unknown>,
): Record<string, unknown> {
  const jsonCols = JSON_COLUMNS[table] ?? [];
  const boolCols = BOOLEAN_COLUMNS[table] ?? [];
  const serverOwned = SERVER_OWNED_COLUMNS[table] ?? [];
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opData)) {
    if (serverOwned.includes(key)) continue;
    if (jsonCols.includes(key)) {
      record[key] =
        typeof value === "string" && value !== ""
          ? parseJsonColumn(table, key, value)
          : value;
    } else if (boolCols.includes(key)) {
      record[key] = value == null ? value : !!value;
    } else {
      record[key] = value;
    }
  }
  return record;
}

// SQLSTATE uses five alphanumeric characters, not five digits.
// 22: invalid data; 23: integrity constraints; 42501: denied by policy.
// Other 42 and PostgREST schema-cache errors require a deployment repair.
// Auth and temporary failures remain in PowerSync for automatic retries.
export function classifySyncError(error: unknown): FailureKind {
  if (error instanceof FatalSyncError) return "data";
  const { code, status } = (error ?? {}) as { code?: string; status?: number };
  if (status === 401 || code === "PGRST301" || code === "PGRST302" || code === "28000" || code === "28P01") return "auth";
  if (code === "42501" || status === 403) return "permission";
  if (/^(22|23)[A-Z0-9]{3}$/.test(code ?? "")) return "data";
  if (/^42[A-Z0-9]{3}$/.test(code ?? "") || /^PGRST20[0-5]$/.test(code ?? "")) return "schema";
  return "transient";
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  constructor(private ownerId?: string) {}

  private async requireOwner(): Promise<{ ownerId: string; authorization: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || (this.ownerId && session.user.id !== this.ownerId)) {
      throw Object.assign(new Error("Sign in to the account that made these changes."), { status: 401 });
    }
    this.ownerId = session.user.id;
    return { ownerId: this.ownerId, authorization: `Bearer ${session.access_token}` };
  }

  async fetchCredentials() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || (this.ownerId && session.user.id !== this.ownerId)) return null;
    return {
      endpoint: POWERSYNC_URL,
      token: session.access_token,
    };
  }

  private async applyOp(op: CrudEntry): Promise<void> {
    const { authorization } = await this.requireOwner();
    if (op.opData?.user_id && op.opData.user_id !== this.ownerId) throw Object.assign(new Error("Change belongs to another account."), { code: "42501" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = supabase.from(op.table as any);
    if (op.op === UpdateType.PUT) {
      const record = { ...toPostgresRecord(op.table, op.opData ?? {}), id: op.id };
      const data = op.opData ?? {};
      if (op.table === "notes" && data.user_id && !data.source_app && !data.is_external
          && !data.is_trashed && data.ai_visibility !== "hidden") {
        await captureNoteWithLexicon(record, authorization);
        return;
      }
      const { error } = await table.upsert(record).setHeader("Authorization", authorization);
      if (error) throw error;
    } else if (op.op === UpdateType.PATCH) {
      if (op.opData && Object.keys(op.opData).length > 0) {
        const record = toPostgresRecord(op.table, op.opData);
        if (Object.keys(record).length > 0) {
          const { error } = await table.update(record).eq("id", op.id).setHeader("Authorization", authorization);
          if (error) throw error;
        }
      }
    } else if (op.op === UpdateType.DELETE) {
      const { error } = await table.delete().eq("id", op.id).setHeader("Authorization", authorization);
      if (error) throw error;
    }
  }

  private async runBatch(batch: RecoveryBatch, all: RecoveryBatch[], owner: string): Promise<void> {
    while (batch.completed < batch.operations.length) {
      try {
        await this.applyOp(batch.operations[batch.completed]);
      } catch (error) {
        const kind = classifySyncError(error);
        if (kind === "auth" || kind === "transient") throw error;
        batch.status = "recovery";
        batch.kind = kind;
        batch.code = (error as { code?: string })?.code;
        await writeRecovery(owner, all);
        return;
      }
      batch.completed++;
      await writeRecovery(owner, all);
    }
  }

  async retryRecovery(): Promise<void> {
    const { ownerId: owner } = await this.requireOwner();
    await withRecoveryLock(owner, async () => {
      const all = await readRecovery(owner);
      for (const batch of all.filter(item => item.status === "recovery")) {
        const earlier = all.slice(0, all.indexOf(batch)).filter(item => item.status === "recovery" && item.completed < item.operations.length);
        if (earlier.some(item => dependentGroups([...item.operations, ...batch.operations]).some(group =>
          group.some(op => item.operations.includes(op)) && group.some(op => batch.operations.includes(op))))) continue;
        await this.runBatch(batch, all, owner);
      }
      await writeRecovery(owner, all.filter(batch => batch.completed < batch.operations.length));
    });
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    const { ownerId: owner } = await this.requireOwner();
    await withRecoveryLock(owner, async () => {
      const all = await readRecovery(owner);
      const current: RecoveryBatch[] = [];
      for (const operations of dependentGroups(transaction.crud)) {
        // clientId is stable across retries. Include payload to avoid collisions
        // after a local database reset under the same account.
        const id = JSON.stringify(operations.map(op => [op.clientId, op.table, op.id, op.op, op.opData]));
        let batch = all.find(item => item.id === id);
        if (!batch) {
          // Keep later edits to a rejected row with its original operations.
          const dependency = all.find(item => item.status === "recovery" &&
            dependentGroups([...item.operations, ...operations]).some(group =>
              group.some(op => item.operations.includes(op)) && group.some(op => operations.includes(op))));
          batch = { id, operations, completed: 0, status: dependency ? "recovery" : "uploading", kind: dependency?.kind, createdAt: new Date().toISOString() };
          all.push(batch);
        }
        current.push(batch);
      }
      // A failed durable write prevents both network changes and acknowledgement.
      await writeRecovery(owner, all);
      for (const batch of current) {
        if (batch.status !== "recovery") await this.runBatch(batch, all, owner);
      }
      await this.requireOwner();
      await transaction.complete();
      await writeRecovery(owner, all.filter(batch => batch.status === "recovery" || !current.includes(batch)));
    });
  }
}
