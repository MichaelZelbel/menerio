import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateGodspeedKey } from "../_shared/mc-auth.ts";
import { checkRateLimit } from "../_shared/mc-rate-limit.ts";
import { json, errorJson, handleOptions, intParam, parsePath } from "../_shared/mc-helpers.ts";
import {
  parseLimit,
  parseUpdatedSince,
  readWindow,
  relationshipExclusionFilter,
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
  /** Every contact assistants may not see: sensitive or not 'visible', whatever the setting says. */
  unshownContactIds: string[];
}

/**
 * The visibility gate every other reader already goes through. Anything hidden
 * from AI stays hidden here, and a person marked sensitive is left out whole
 * rather than written to disk with their name showing: this copy lands in a git
 * repository, so a redacted row is still a row somebody can read forever.
 */
async function loadGate(supabase: any, userId: string): Promise<Gate> {
  const [
    { data: prefs, error: prefsError },
    { data: sensitive, error: sensitiveError },
    { data: unshown, error: unshownError },
  ] = await Promise.all([
    supabase.from("mcp_preferences").select("hide_sensitive_from_ai").eq("user_id", userId).maybeSingle(),
    supabase.from("contacts").select("id").eq("user_id", userId).eq("is_sensitive", true).is("merged_into", null),
    // The same people agent_facts leaves out (plan 3.3), for the relationship
    // arm of world_claims, which does not read agent_facts.
    supabase.from("contacts").select("id").eq("user_id", userId).or("is_sensitive.eq.true,ai_visibility.neq.visible,ai_visibility.is.null"),
  ]);
  // Fail closed. An unread error left the sensitive list empty, and every
  // sensitive person, with the facts and moments about them, went out to be
  // written into a git repository.
  if (prefsError || sensitiveError || unshownError) throw (prefsError ?? sensitiveError ?? unshownError);
  return {
    hideSensitive: prefs?.hide_sensitive_from_ai ?? true,
    sensitiveIds: (sensitive ?? []).map((r: any) => r.id),
    unshownContactIds: (unshown ?? []).map((r: any) => r.id),
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
    // Every read goes through readWindow: limit may be up to 2000 and the
    // server returns at most 1000 rows per request.
    const fetchEntities = async () => {
      const rows = await readWindow<any>((from, to) => {
        let q = supabase
          .from("world_entities")
          .select("*")
          .eq("user_id", userId)
          .neq("ai_visibility", "hidden")
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
        if (since.value) q = q.gte("updated_at", since.value);
        if (hideIds.length > 0) q = q.not("id", "in", notInList(hideIds));
        return q;
      }, offset, limit);
      return rows.map(toWorldEntity);
    };

    const fetchEvents = async () => {
      const rows = await readWindow<any>((from, to) => {
        let q = supabase
          .from("world_events")
          .select("*")
          .eq("user_id", userId)
          .neq("ai_visibility", "hidden")
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
        if (since.value) q = q.gte("updated_at", since.value);
        if (hideIds.length > 0) {
          q = q.or(`person_id.is.null,person_id.not.in.${notInList(hideIds)}`);
        }
        return q;
      }, offset, limit);
      return rows.map(toWorldEvent);
    };

    // world_claims is agent_facts plus relationships (plan 3.4): its claim arm
    // already leaves out private sections and hidden or sensitive subjects,
    // whatever hide_sensitive_from_ai says. The relationship arm does not, so
    // a relationship from or to such a person is filtered here, in the
    // database: filtering in memory after .range() made short pages, and a
    // client paging until a short page stopped early.
    const exclusion = relationshipExclusionFilter([...gate.unshownContactIds, ...hideIds]);
    const fetchClaims = async () => {
      const rows = await readWindow<any>((from, to) => {
        let q = supabase
          .from("world_claims")
          .select("*")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to);
        if (since.value) q = q.gte("updated_at", since.value);
        if (exclusion) q = q.or(exclusion);
        return q;
      }, offset, limit);
      return rows.map(toWorldClaim);
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
