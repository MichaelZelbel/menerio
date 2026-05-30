import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAliasMap, resolvePeopleDetailed, type Contact } from "../_shared/graph-matching.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ContactRow {
  id: string;
  name: string;
  aliases: string[] | null;
}

async function loadContacts(userId: string): Promise<ContactRow[]> {
  const { data } = await supabase
    .from("contacts")
    .select("id, name, aliases")
    .eq("user_id", userId);
  return (data || []) as ContactRow[];
}

function buildPersonNameSet(contacts: ContactRow[]): Set<string> {
  const set = new Set<string>();
  for (const c of contacts) {
    if (c.name) set.add(String(c.name).trim().toLowerCase());
    for (const a of (c.aliases || [])) {
      if (a) set.add(String(a).trim().toLowerCase());
    }
  }
  return set;
}

function resolveNodeType(
  n: { title: string; metadata: unknown; entity_type: string | null },
  personNameSet: Set<string>,
): string {
  const m = (n.metadata || {}) as Record<string, unknown>;
  const explicit = (m.type as string) || n.entity_type || null;
  if (explicit === "person_note") return explicit;
  const titleLower = (n.title || "").trim().toLowerCase();
  if (titleLower && personNameSet.has(titleLower)) return "person_note";
  return explicit || "note";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface NoteRow {
  id: string;
  title: string;
  metadata: any;
  tags: string[] | null;
  entity_type: string | null;
  created_at: string;
}

interface OutNode {
  id: string;
  title: string;
  type: string;
  topics: string[];
  tags: string[];
  created_at: string;
}

interface OutEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
  metadata: Record<string, unknown>;
}

/** Normalize a name for fuzzy matching: lowercase, strip diacritics, collapse non-alphanumerics. */
function normalizeName(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Levenshtein distance with early exit at maxDist. */
function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const n = a.length, m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= m; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

interface ContactResolverIndex {
  exact: Map<string, string>;       // lowercase name/alias -> contact id
  normalized: Map<string, string>;  // normalized name/alias -> contact id
  variants: Array<{ norm: string; id: string }>; // for fuzzy
}

function buildContactResolverIndex(contacts: ContactRow[]): ContactResolverIndex {
  const exact = new Map<string, string>();
  const normalized = new Map<string, string>();
  const variants: Array<{ norm: string; id: string }> = [];
  for (const c of contacts) {
    const all = [c.name, ...((c.aliases || []) as string[])].filter(Boolean);
    for (const v of all) {
      const lower = String(v).trim().toLowerCase();
      if (lower && !exact.has(lower)) exact.set(lower, c.id);
      const norm = normalizeName(v);
      if (norm && !normalized.has(norm)) normalized.set(norm, c.id);
      if (norm) variants.push({ norm, id: c.id });
    }
  }
  return { exact, normalized, variants };
}

/**
 * Resolve a free-form mention name to a real contact id, or null if no confident match.
 * Order: exact lowercase → normalized → fuzzy (Levenshtein ≤ 2, unique).
 */
function resolveMentionToContact(name: string, idx: ContactResolverIndex): string | null {
  const lower = (name || "").trim().toLowerCase();
  if (!lower) return null;
  const exact = idx.exact.get(lower);
  if (exact) return exact;
  const norm = normalizeName(name);
  if (!norm) return null;
  const nrm = idx.normalized.get(norm);
  if (nrm) return nrm;
  // Fuzzy: only short names, only with a unique match at distance ≤ 2.
  const maxDist = norm.length <= 4 ? 1 : 2;
  let best: { id: string; dist: number } | null = null;
  let bestCount = 0;
  for (const v of idx.variants) {
    const d = levenshtein(norm, v.norm, maxDist);
    if (d > maxDist) continue;
    if (!best || d < best.dist) { best = { id: v.id, dist: d }; bestCount = 1; }
    else if (d === best.dist && v.id !== best.id) bestCount++;
  }
  if (best && bestCount === 1) return best.id;
  return null;
}

/**
 * Pivot shared_person edges through real person nodes (contacts only).
 * If a mention cannot be resolved to a contact, we DROP the pivot for that name
 * and keep the direct note↔note shared_person edge instead — no synthetic
 * `person:<name>` nodes that would be unclickable.
 */
function pivotSharedPersonEdges(
  notes: NoteRow[],
  connections: any[],
  contacts: ContactRow[],
  aliasMap: Map<string, string>,
): { nodes: OutNode[]; edges: OutEdge[] } {
  const personNameSet = buildPersonNameSet(contacts);
  const resolverIdx = buildContactResolverIndex(contacts);
  const noteById = new Map<string, NoteRow>();
  for (const n of notes) noteById.set(n.id, n);

  // contactId -> profile note id (where a note's title matches the contact name/alias)
  const profileNoteByContact = new Map<string, string>();
  for (const c of contacts) {
    const candidates = [c.name, ...(c.aliases || [])].filter(Boolean).map((s) => s.toLowerCase());
    for (const n of notes) {
      const t = (n.title || "").trim().toLowerCase();
      if (t && candidates.includes(t)) {
        profileNoteByContact.set(c.id, n.id);
        break;
      }
    }
  }
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const outNodes: OutNode[] = notes.map((n) => ({
    id: n.id,
    title: n.title,
    type: resolveNodeType(n, personNameSet),
    topics: (n.metadata as any)?.topics || [],
    tags: n.tags || [],
    created_at: n.created_at,
  }));

  const seenNodeIds = new Set(outNodes.map((n) => n.id));
  const outEdges: OutEdge[] = [];
  // Dedup mentions_person edges per (note,person)
  const mentionsSeen = new Set<string>();

  function ensureContactNode(contactId: string): { nodeId: string; title: string } {
    const profileId = profileNoteByContact.get(contactId);
    if (profileId) {
      const profile = noteById.get(profileId);
      return { nodeId: profileId, title: profile?.title || contactById.get(contactId)?.name || "" };
    }
    const nodeId = `contact:${contactId}`;
    const title = contactById.get(contactId)?.name || "";
    if (!seenNodeIds.has(nodeId)) {
      seenNodeIds.add(nodeId);
      outNodes.push({
        id: nodeId,
        title,
        type: "person_note",
        topics: [],
        tags: [],
        created_at: new Date().toISOString(),
      });
    }
    return { nodeId, title };
  }

  /**
   * Normalize a sharedId to a real contact id (or null).
   * sharedId is either a contact uuid OR `name:<lowercased>` (legacy from compute step).
   */
  function sharedIdToContactId(sharedId: string): string | null {
    if (sharedId.startsWith("name:")) {
      return resolveMentionToContact(sharedId.slice(5), resolverIdx);
    }
    // Treat as contact id if known
    return contactById.has(sharedId) ? sharedId : null;
  }

  for (const c of connections) {
    if (c.connection_type !== "shared_person") {
      outEdges.push({
        id: c.id,
        source: c.source_note_id,
        target: c.target_note_id,
        type: c.connection_type,
        strength: c.strength,
        metadata: c.metadata || {},
      });
      continue;
    }

    // Resolve shared person ids: trust metadata if present, else compute live.
    const sharedIds: string[] = Array.isArray(c.metadata?.shared_person_ids)
      ? [...c.metadata.shared_person_ids]
      : [];
    const sourceNote = noteById.get(c.source_note_id);
    const targetNote = noteById.get(c.target_note_id);
    if (sharedIds.length === 0 && sourceNote && targetNote) {
      const a = resolvePeopleDetailed(((sourceNote.metadata as any)?.people) || [], aliasMap);
      const b = resolvePeopleDetailed(((targetNote.metadata as any)?.people) || [], aliasMap);
      for (const id of a.keys()) if (b.has(id)) sharedIds.push(id);
    }
    if (sharedIds.length === 0) continue;

    let pivotedAny = false;
    for (const pid of sharedIds) {
      const contactId = sharedIdToContactId(pid);
      if (!contactId) continue; // unresolved → skip pivot for this name

      const { nodeId, title } = ensureContactNode(contactId);

      for (const noteId of [c.source_note_id, c.target_note_id]) {
        if (noteId === nodeId) continue; // person profile already IS this note
        const key = `${noteId}::${nodeId}`;
        if (mentionsSeen.has(key)) continue;
        mentionsSeen.add(key);
        outEdges.push({
          id: `mp:${c.id}:${contactId}:${noteId}`,
          source: noteId,
          target: nodeId,
          type: "mentions_person",
          strength: c.strength,
          metadata: { via_person_id: contactId, via_person_name: title },
        });
      }
      pivotedAny = true;
    }

    // Fallback: no pivot succeeded → keep original direct shared_person edge
    // so the connection isn't lost and the graph stays meaningful.
    if (!pivotedAny) {
      outEdges.push({
        id: c.id,
        source: c.source_note_id,
        target: c.target_note_id,
        type: c.connection_type,
        strength: c.strength,
        metadata: c.metadata || {},
      });
    }
  }

  return { nodes: outNodes, edges: outEdges };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const {
      note_id,
      hops = 2,
      limit = 200,
      min_strength = 0,
      connection_types,
      note_type,
      topic,
      person,
      include_hidden = false,
    } = body;

    const contacts = await loadContacts(user.id);
    const aliasMap = buildAliasMap(contacts as Contact[]);

    // Neighborhood mode: BFS from a note
    if (note_id) {
      const visited = new Set<string>();
      const queue: { id: string; depth: number }[] = [{ id: note_id, depth: 0 }];
      visited.add(note_id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= hops) continue;

        const { data: edges } = await supabase
          .from("note_connections")
          .select("source_note_id, target_note_id")
          .eq("user_id", user.id)
          .gte("strength", min_strength)
          .or(`source_note_id.eq.${current.id},target_note_id.eq.${current.id}`);

        for (const e of edges || []) {
          const neighbor = e.source_note_id === current.id ? e.target_note_id : e.source_note_id;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ id: neighbor, depth: current.depth + 1 });
          }
        }
      }

      const noteIds = Array.from(visited);
      if (noteIds.length === 0) return json({ nodes: [], edges: [] });

      let notesQ = supabase
        .from("notes")
        .select("id, title, metadata, tags, entity_type, created_at, ai_visibility")
        .eq("user_id", user.id)
        .eq("is_trashed", false)
        .in("id", noteIds);
      if (!include_hidden) notesQ = notesQ.eq("ai_visibility", "visible");
      const { data: notes } = await notesQ;

      const { data: connections } = await supabase
        .from("note_connections")
        .select("id, source_note_id, target_note_id, connection_type, strength, metadata")
        .eq("user_id", user.id)
        .gte("strength", min_strength)
        .in("source_note_id", noteIds)
        .in("target_note_id", noteIds);

      const result = pivotSharedPersonEdges(
        (notes || []) as NoteRow[],
        connections || [],
        contacts,
        aliasMap,
      );
      return json(result);
    }

    // Full graph mode
    let notesQuery = supabase
      .from("notes")
      .select("id, title, metadata, tags, entity_type, created_at, ai_visibility")
      .eq("user_id", user.id)
      .eq("is_trashed", false)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!include_hidden) notesQuery = notesQuery.eq("ai_visibility", "visible");

    if (note_type) {
      notesQuery = notesQuery.eq("entity_type", note_type);
    }

    const { data: notes } = await notesQuery;
    if (!notes || notes.length === 0) return json({ nodes: [], edges: [] });

    let filteredNotes = notes as NoteRow[];
    if (topic) {
      filteredNotes = filteredNotes.filter((n) => {
        const t = (n.metadata as any)?.topics;
        return Array.isArray(t) && t.some((tp: string) => tp.toLowerCase().includes(topic.toLowerCase()));
      });
    }
    if (person) {
      filteredNotes = filteredNotes.filter((n) => {
        const p = (n.metadata as any)?.people;
        return Array.isArray(p) && p.some((pp: string) => pp.toLowerCase().includes(person.toLowerCase()));
      });
    }

    const noteIds = filteredNotes.map((n) => n.id);
    if (noteIds.length === 0) return json({ nodes: [], edges: [] });

    let allConnections: any[] = [];
    const batchSize = 50;
    for (let i = 0; i < noteIds.length; i += batchSize) {
      const batch = noteIds.slice(i, i + batchSize);
      let connQuery = supabase
        .from("note_connections")
        .select("id, source_note_id, target_note_id, connection_type, strength, metadata")
        .eq("user_id", user.id)
        .gte("strength", min_strength)
        .in("source_note_id", batch)
        .in("target_note_id", noteIds);

      if (connection_types && Array.isArray(connection_types) && connection_types.length > 0) {
        connQuery = connQuery.in("connection_type", connection_types);
      }

      const { data } = await connQuery;
      if (data) allConnections = allConnections.concat(data);
    }

    const result = pivotSharedPersonEdges(filteredNotes, allConnections, contacts, aliasMap);
    return json(result);
  } catch (err) {
    console.error("get-graph-data error:", err);
    return json({ error: err instanceof Error ? err.message : "An unknown error occurred" }, 500);
  }
});
