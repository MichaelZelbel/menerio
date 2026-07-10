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
        typeof value === "string" && value !== "" ? JSON.parse(value) : value;
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

  async uploadData(database: AbstractPowerSyncDatabase): Promise<void> {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    let lastOp: CrudEntry | null = null;
    try {
      for (const op of transaction.crud) {
        lastOp = op;
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
      await transaction.complete();
    } catch (error) {
      if (isFatalError(error)) {
        // Discarding is the only way forward — retrying would wedge the
        // upload queue for every subsequent edit.
        console.error("Discarding unrecoverable sync operation", lastOp, error);
        await transaction.complete();
      } else {
        throw error; // PowerSync retries with backoff
      }
    }
  }
}
