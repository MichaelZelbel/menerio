import {
  AbstractPowerSyncDatabase,
  CrudEntry,
  PowerSyncBackendConnector,
  UpdateType,
} from "@powersync/web";
import { supabase } from "@/integrations/supabase/client";
import { POWERSYNC_URL } from "./config";

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

// Postgres error classes that will never succeed on retry: bad data (22xxx),
// integrity violations (23xxx), insufficient privilege / undefined object
// (42xxx). Anything else (network, 5xx, auth refresh) is retried.
const FATAL_CODES = [/^22\d{3}$/, /^23\d{3}$/, /^42\d{3}$/];

function isFatalError(error: unknown): boolean {
  if (error instanceof FatalSyncError) return true;
  const code = (error as { code?: string } | null)?.code;
  if (typeof code !== "string") return false;
  return FATAL_CODES.some((re) => re.test(code));
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    return {
      endpoint: POWERSYNC_URL,
      token: session.access_token,
    };
  }

  private async applyOp(op: CrudEntry): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = supabase.from(op.table as any);
    if (op.op === UpdateType.PUT) {
      const record = { ...toPostgresRecord(op.table, op.opData ?? {}), id: op.id };
      const { error } = await table.upsert(record);
      if (error) throw error;
    } else if (op.op === UpdateType.PATCH) {
      if (op.opData && Object.keys(op.opData).length > 0) {
        const record = toPostgresRecord(op.table, op.opData);
        if (Object.keys(record).length > 0) {
          const { error } = await table.update(record).eq("id", op.id);
          if (error) throw error;
        }
      }
    } else if (op.op === UpdateType.DELETE) {
      const { error } = await table.delete().eq("id", op.id);
      if (error) throw error;
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    // A permanently-failing op is skipped, NOT allowed to take the rest of the
    // transaction with it. The previous version completed the whole transaction
    // from inside the catch, so every op after the failing one was discarded
    // without ever being attempted — silent loss of the user's later edits.
    //
    // A retryable failure still throws, so PowerSync replays the transaction
    // with backoff. Replay is safe: PUT is an upsert, PATCH and DELETE are keyed
    // by id, so re-applying an op that already succeeded is a no-op.
    const discarded: Array<{ op: CrudEntry; error: unknown }> = [];
    for (const op of transaction.crud) {
      try {
        await this.applyOp(op);
      } catch (error) {
        if (!isFatalError(error)) throw error;
        discarded.push({ op, error });
      }
    }

    for (const { op, error } of discarded) {
      console.error("Discarding unrecoverable sync operation", op, error);
    }
    await transaction.complete();
  }
}
