import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const normalize = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const splitParticipants = (value: unknown) => String(value || "").split(/[;,]/).map((p) => p.trim()).filter(Boolean);

type ContactRow = { id: string; name: string; aliases?: string[] | null; app_mappings?: Record<string, unknown> | null };
type ImportedPerson = { name: string; relationship_label?: string | null; person_uid?: string | null };
type ImportedMoment = Record<string, unknown> & { title: string; description?: string | null; happened_at: string; moment_uid: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const people = Array.isArray(body.people) ? body.people as ImportedPerson[] : [];
    const moments = Array.isArray(body.moments) ? body.moments as ImportedMoment[] : [];
    if (moments.length === 0) return json({ error: "No moments provided" }, 400);

    const { data: contactsData, error: contactsError } = await supabase
      .from("contacts")
      .select("id, name, aliases, app_mappings")
      .eq("user_id", user.id)
      .is("merged_into", null);
    if (contactsError) throw contactsError;

    const contacts = [...((contactsData || []) as ContactRow[])];
    const byName = new Map<string, ContactRow>();
    const byFirst = new Map<string, ContactRow[]>();
    const byTemerioUid = new Map<string, ContactRow>();

    const indexContact = (contact: ContactRow) => {
      byName.set(normalize(contact.name), contact);
      for (const alias of contact.aliases || []) byName.set(normalize(alias), contact);
      const first = normalize(contact.name).split(" ")[0];
      if (first) byFirst.set(first, [...(byFirst.get(first) || []), contact]);
      const uid = (contact.app_mappings as any)?.temerio?.person_uid;
      if (uid) byTemerioUid.set(String(uid), contact);
    };
    contacts.forEach(indexContact);

    const findContact = (name: string, temerioUid?: string | null) => {
      if (temerioUid && byTemerioUid.has(temerioUid)) return byTemerioUid.get(temerioUid)!;
      const key = normalize(name);
      if (byName.has(key)) return byName.get(key)!;
      const firstMatches = byFirst.get(key);
      if (firstMatches?.length === 1) return firstMatches[0];
      return null;
    };

    let createdContacts = 0;
    let matchedContacts = 0;
    const ensureContact = async (name: string, person?: ImportedPerson | null) => {
      const cleanName = String(name || "").trim();
      if (!cleanName) return null;
      const existing = findContact(cleanName, person?.person_uid || null);
      if (existing) {
        matchedContacts += 1;
        if (person?.person_uid && !(existing.app_mappings as any)?.temerio?.person_uid) {
          const appMappings = { ...(existing.app_mappings || {}), temerio: { person_uid: person.person_uid, imported_name: cleanName } };
          await supabase.from("contacts").update({ app_mappings: appMappings }).eq("id", existing.id);
          existing.app_mappings = appMappings;
          byTemerioUid.set(person.person_uid, existing);
        }
        return existing;
      }

      const { data: inserted, error } = await supabase.from("contacts").insert({
        user_id: user.id,
        name: cleanName,
        relationship: person?.relationship_label || null,
        app_mappings: person?.person_uid ? { temerio: { person_uid: person.person_uid, imported_name: cleanName } } : { temerio: { imported_name: cleanName } },
        tags: ["temerio-import"],
      }).select("id, name, aliases, app_mappings").single();
      if (error) throw error;
      createdContacts += 1;
      const contact = inserted as ContactRow;
      contacts.push(contact);
      indexContact(contact);
      return contact;
    };

    const peopleByName = new Map(people.map((p) => [normalize(p.name), p]));
    for (const person of people) await ensureContact(person.name, person);

    let createdMoments = 0;
    let updatedMoments = 0;
    let participantLinks = 0;

    for (const moment of moments) {
      const names = Array.from(new Set([String(moment.primary_person || "").trim(), ...splitParticipants(moment.participants)].filter(Boolean)));
      const linkedContacts = [] as ContactRow[];
      for (const name of names) {
        const contact = await ensureContact(name, peopleByName.get(normalize(name)) || null);
        if (contact) linkedContacts.push(contact);
      }

      const primaryName = String(moment.primary_person || "").trim();
      const primary = primaryName ? linkedContacts.find((c) => normalize(c.name) === normalize(primaryName)) : linkedContacts[0];
      const momentData = {
        user_id: user.id,
        title: String(moment.title || "Untitled moment"),
        description: moment.description ? String(moment.description) : null,
        happened_at: String(moment.happened_at),
        happened_end: moment.happened_end ? String(moment.happened_end) : null,
        status: moment.status ? String(moment.status) : "unknown",
        impact_level: Number(moment.impact_level ?? 2),
        confidence_date: Number(moment.confidence_date ?? 5),
        confidence_truth: Number(moment.confidence_truth ?? 5),
        category: moment.category ? String(moment.category) : null,
        person_id: primary?.id || null,
        source: "temerio",
        verified: Boolean(moment.verified),
        is_potential_major: Boolean(moment.is_potential_major),
        attachments: {
          source_app: "temerio",
          source_id: String(moment.moment_uid),
          moment_uid: String(moment.moment_uid),
          documents: moment.documents || null,
          provenance_snippets: moment.provenance_snippets || null,
          imported_from: "temerio_export_all.xlsx",
        },
      };

      const { data: existing, error: lookupError } = await supabase
        .from("moments")
        .select("id")
        .eq("user_id", user.id)
        .eq("source", "temerio")
        .eq("attachments->>source_id", String(moment.moment_uid))
        .maybeSingle();
      if (lookupError) throw lookupError;

      const saved = existing
        ? await supabase.from("moments").update(momentData).eq("id", existing.id).select("id").single()
        : await supabase.from("moments").insert(momentData).select("id").single();
      if (saved.error) throw saved.error;
      if (existing) updatedMoments += 1;
      else createdMoments += 1;

      const momentId = (saved.data as { id: string }).id;
      await supabase.from("moment_participants").delete().eq("moment_id", momentId);
      const uniqueContacts = Array.from(new Map(linkedContacts.map((c) => [c.id, c])).values());
      if (uniqueContacts.length > 0) {
        const { error: participantError } = await supabase.from("moment_participants").insert(uniqueContacts.map((c) => ({ moment_id: momentId, person_id: c.id })));
        if (participantError) throw participantError;
        participantLinks += uniqueContacts.length;
      }
    }

    return json({ imported: { people: people.length, moments: moments.length }, createdContacts, matchedContacts, createdMoments, updatedMoments, participantLinks });
  } catch (error) {
    console.error("import-temerio-export error", error);
    return json({ error: error instanceof Error ? error.message : "Internal error" }, 500);
  }
});
