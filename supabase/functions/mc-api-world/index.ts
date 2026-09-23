import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateGodspeedKey } from "../_shared/mc-auth.ts";
import { checkRateLimit } from "../_shared/mc-rate-limit.ts";
import { json, errorJson, handleOptions, intParam, parsePath } from "../_shared/mc-helpers.ts";
import {
  parseLimit,
  parseUpdatedSince,
  toWorldClaim,
  toWorldEntity,
  toWorldEvent,
} from "../_shared/world-records.ts";

/**
 * The World, read only, for Mission Control's `world/` folder.
 *
 * It writes nothing. Ever. Mission Control keeps a copy of these records as markdown so
 * the facts survive if Menerio disappears, and a copy that could write back
 * would give one fact two writers, which is the one thing the whole design
 * refuses.
 *
 * Scope: `world` if the key has it, otherwise `contacts`. A key cut before this
 * endpoint existed cannot have a `world` scope, and asking Michael to make a new
 * key by hand for a capability we can simply accept would be homework, not
 * security. New keys can be cut narrowly.
 */
const ACCEPTED_SCOPES = ["world", "contacts"];

interface Gate {
  sensitiveIds: string[];
  hideSensitive: boolean;
}

/**
 * The visibility gate every other reader already goes through. Anything hidden
 * from AI stays hidden here, and a person marked sensitive is left out whole
 * rather than written to disk with their name showing: this copy lands in a git
 * repository, so a redacted row is still a row somebody can read forever.
 */
async function loadGate(supabase: any, userId: string): Promise<Gate> {
  const [{ data: prefs, error: prefsError }, { data: sensitive, error: sensitiveError }] = await Promise.all([
    supabase.from("mcp_preferences").select("hide_sensitive_from_ai").eq("user_id", userId).maybeSingle(),
    supabase.from("contacts").select("id").eq("user_id", userId).eq("is_sensitive", true).is("merged_into", null),
  ]);
  // Fail closed. An unread error left the sensitive list empty, and every
  // sensitive person, with the facts and moments about them, went out to be
  // written into a git repository.
  if (prefsError || sensitiveError) throw (prefsError ?? sensitiveError);
  return {
    hideSensitive: prefs?.hide_sensitive_from_ai ?? true,
    sensitiveIds: (sensitive ?? []).map((r: any) => r.id),
  };
}

function notInList(ids: string[]): string {
  return `(${ids.join(",")})`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  if (req.method !== "GET") {
    return errorJson("READ_ONLY", "The World endpoint only reads. Fix a fact in Menerio, not here.", 405);
  }

  const { result: auth, error: authErr } = await authenticateGodspeedKey(req);
  if (authErr) return authErr;

  const scopes = auth!.scopes || [];
  if (!ACCEPTED_SCOPES.some((s) => scopes.includes(s))) {
    return errorJson(
      "FORBIDDEN",
      `This key needs one of these scopes: ${ACCEPTED_SCOPES.join(", ")}.`,
      403,
    );
  }

  const rl = await checkRateLimit(auth!.keyId);
  if (!rl.allowed) return rl.error!;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const userId = auth!.userId;
  const url = new URL(req.url);
  const parts = parsePath(url);
  const kind = (parts[1] || "").toLowerCase();

  const since = parseUpdatedSince(url.searchParams.get("updated_since"));
  if (since.error) return errorJson("BAD_REQUEST", since.error, 400);
  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = intParam(url, "offset", 0, 0, Number.MAX_SAFE_INTEGER);

  try {
    const gate = await loadGate(supabase, userId);
    const hideIds = gate.hideSensitive ? gate.sensitiveIds : [];

    // updated_at alone is not a total order: rows touched by one bulk update
    // share it, and PostgREST may return them in a different order on the next
    // page, so a client paging by offset skipped some and saw others twice.
    const fetchEntities = async () => {
      let q = supabase
        .from("world_entities")
        .select("*")
        .eq("user_id", userId)
        .neq("ai_visibility", "hidden")
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      if (since.value) q = q.gte("updated_at", since.value);
      if (hideIds.length > 0) q = q.not("id", "in", notInList(hideIds));
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(toWorldEntity);
    };

    const fetchEvents = async () => {
      let q = supabase
        .from("world_events")
        .select("*")
        .eq("user_id", userId)
        .neq("ai_visibility", "hidden")
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      if (since.value) q = q.gte("updated_at", since.value);
      if (hideIds.length > 0) {
        q = q.or(`person_id.is.null,person_id.not.in.${notInList(hideIds)}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(toWorldEvent);
    };

    const fetchClaims = async () => {
      let q = supabase
        .from("world_claims")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      if (since.value) q = q.gte("updated_at", since.value);
      if (hideIds.length > 0) {
        // A claim about a sensitive person, or pointing at one through
        // `object_id`, is left out. Both conditions go to the database as one
        // nested filter. The object_id half used to run in memory AFTER
        // `.range()`, so a page came back shorter than `limit` whenever it held
        // such a claim, and a client paging until it gets a short page stopped
        // early and never saw the rest.
        const list = notInList(hideIds);
        q = q.or(
          `and(or(subject_id.is.null,subject_id.not.in.${list}),or(object_id.is.null,object_id.not.in.${list}))`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(toWorldClaim);
    };

    if (kind === "entities") return json({ data: await fetchEntities() });
    if (kind === "events") return json({ data: await fetchEvents() });
    if (kind === "claims") return json({ data: await fetchClaims() });

    if (kind === "" ) {
      const [entities, events, claims] = await Promise.all([
        fetchEntities(),
        fetchEvents(),
        fetchClaims(),
      ]);
      return json({
        data: { entities, events, claims },
        meta: {
          updated_since: since.value,
          limit,
          offset,
          counts: {
            entities: entities.length,
            events: events.length,
            claims: claims.length,
          },
        },
      });
    }

    return errorJson("NOT_FOUND", "Use /entities, /events, /claims, or the root for all three.", 404);
  } catch (err) {
    return errorJson("INTERNAL", (err as Error).message, 500);
  }
});
