import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isValidCronRequest } from "../_shared/cron-auth.ts";
import { createNoteAiWorkerHandler } from "../_shared/note-ai-worker-http.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

Deno.serve(createNoteAiWorkerHandler({
  background: (execution) => {
    // Supabase provides this API; HTTP acknowledgment is not job completion.
    // @ts-expect-error EdgeRuntime is provided by the deployed runtime.
    EdgeRuntime.waitUntil(execution.then(async (response) => {
      console.log("[note-ai-worker]", response.status, await response.json());
    }));
  },
  authorized: (request) => isValidCronRequest(request),
  settings: async () => {
    const { data, error } = await db.from("note_ai_worker_settings")
      .select("enabled,user_ids").eq("id", true).maybeSingle();
    if (error) throw error;
    return data;
  },
  rpc: async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  },
  execute: async (job) => {
    const endpoint = job.pipeline === "analysis" ? "process-note" : "wiki-ingest";
    const response = await fetch(`${url}/functions/v1/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ execute: true, job_id: job.id, lease_id: job.lease_id, user_id: job.user_id, note_id: job.note_id }),
      signal: AbortSignal.timeout(110_000),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, finished: body.finished === true };
  },
}));
