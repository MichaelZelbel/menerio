// Sweep-export and pull-apply logic for the People & Groups vault mirror.
// Used by github-people-sync (export/conflicts) and github-sync-pull (pull).
//
// Design contract (see plan "Bidirectional People & Groups Mirror"):
// - Person frontmatter `groups:` is the canonical, writable membership list;
//   group pages' member tables are generated read-only.
// - Membership removals coming from the vault ARCHIVE the membership row,
//   never delete it.
// - Facts/member blocks between marker comments are regenerated on export and
//   ignored on pull.

import {
  githubDeleteFile,
  githubGetFile,
  githubGetFileContent,
  githubPutFile,
} from "./github-api.ts";
import {
  buildGroupMarkdown,
  buildGroupPath,
  buildPersonMarkdown,
  buildPersonPath,
  contentEffectivelyEqual,
  GROUP_TYPES,
  GROUPS_DIR,
  incrementPath,
  normalizeName,
  normalizePathPart,
  ParsedGroupFile,
  ParsedPersonFile,
  parseGroupMarkdown,
  parsePersonMarkdown,
  pathMatchesName,
  PEOPLE_DIR,
  VaultParseError,
} from "./people-vault.ts";

type DbClient = any;

export interface GhCtx {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  vaultPath: string;
}

interface PeopleData {
  contacts: any[];
  groups: any[];
  /** ALL memberships incl. archived — archived rows still count for dirty
   * detection (archiving bumps updated_at); content uses liveMemberships. */
  memberships: any[];
  entries: any[];
  categories: any[];
  syncRows: any[];
}

const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "group";

function ts(value: unknown): number {
  const n = Date.parse(String(value || ""));
  return Number.isFinite(n) ? n : 0;
}

function entityKey(type: string, id: string): string {
  return `${type}:${id}`;
}

export async function loadPeopleData(db: DbClient, userId: string): Promise<PeopleData> {
  // Explicit range: PostgREST's default 1000-row cap would silently truncate
  // large datasets, and a truncated contacts list would make the retire pass
  // delete files for contacts that still exist.
  const MAX = 9999;
  const [contactsRes, groupsRes, membershipsRes, entriesRes, categoriesRes, syncRes] = await Promise.all([
    db.from("contacts").select("*").eq("user_id", userId).range(0, MAX),
    db.from("contact_groups").select("*").eq("user_id", userId).range(0, MAX),
    db.from("contact_group_memberships").select("*").eq("user_id", userId).range(0, MAX),
    db.from("profile_entries").select("*").eq("user_id", userId).not("contact_id", "is", null).range(0, MAX),
    db.from("profile_categories").select("*").eq("user_id", userId).not("contact_id", "is", null).range(0, MAX),
    db.from("github_sync_log").select("*").eq("user_id", userId).in("entity_type", ["person", "group"]).range(0, MAX),
  ]);
  for (const res of [contactsRes, groupsRes, membershipsRes, entriesRes, categoriesRes, syncRes]) {
    if (res.error) throw new Error(`People sync data load failed: ${res.error.message}`);
  }
  return {
    contacts: contactsRes.data || [],
    groups: groupsRes.data || [],
    memberships: membershipsRes.data || [],
    entries: entriesRes.data || [],
    categories: categoriesRes.data || [],
    syncRows: syncRes.data || [],
  };
}

// ─── Indexing helpers ────────────────────────────────────────────────

function indexData(data: PeopleData) {
  const contactsById = new Map<string, any>(data.contacts.map((c) => [c.id, c]));
  const groupsById = new Map<string, any>(data.groups.map((g) => [g.id, g]));
  const membershipsByContact = new Map<string, any[]>();
  const membershipsByGroup = new Map<string, any[]>();
  for (const m of data.memberships) {
    membershipsByContact.set(m.contact_id, [...(membershipsByContact.get(m.contact_id) || []), m]);
    membershipsByGroup.set(m.group_id, [...(membershipsByGroup.get(m.group_id) || []), m]);
  }
  const entriesByContact = new Map<string, any[]>();
  for (const e of data.entries) {
    entriesByContact.set(e.contact_id, [...(entriesByContact.get(e.contact_id) || []), e]);
  }
  const categoriesByContact = new Map<string, any[]>();
  for (const c of data.categories) {
    categoriesByContact.set(c.contact_id, [...(categoriesByContact.get(c.contact_id) || []), c]);
  }
  const syncByEntity = new Map<string, any>();
  for (const row of data.syncRows) {
    syncByEntity.set(entityKey(row.entity_type, row.entity_id), row);
  }
  return {
    contactsById,
    groupsById,
    membershipsByContact,
    membershipsByGroup,
    entriesByContact,
    categoriesByContact,
    syncByEntity,
  };
}

type Index = ReturnType<typeof indexData>;

function personClusterUpdatedAt(contact: any, idx: Index): number {
  let max = ts(contact.updated_at);
  for (const m of idx.membershipsByContact.get(contact.id) || []) max = Math.max(max, ts(m.updated_at));
  for (const e of idx.entriesByContact.get(contact.id) || []) max = Math.max(max, ts(e.updated_at));
  for (const c of idx.categoriesByContact.get(contact.id) || []) max = Math.max(max, ts(c.updated_at));
  return max;
}

function groupClusterUpdatedAt(group: any, idx: Index): number {
  let max = ts(group.updated_at);
  for (const m of idx.membershipsByGroup.get(group.id) || []) max = Math.max(max, ts(m.updated_at));
  return max;
}

// ─── Page-data builders ──────────────────────────────────────────────

function personPageData(contact: any, idx: Index) {
  const groupNames = (idx.membershipsByContact.get(contact.id) || [])
    .filter((m) => !m.archived_at)
    .map((m) => idx.groupsById.get(m.group_id))
    .filter((g) => g && !g.is_trashed)
    .map((g) => String(g.name));
  return {
    contact,
    groupNames: [...new Set(groupNames)],
    categories: idx.categoriesByContact.get(contact.id) || [],
    entries: entriesForPage(contact.id, idx),
  };
}

function entriesForPage(contactId: string, idx: Index) {
  return (idx.entriesByContact.get(contactId) || []).map((e) => ({
    category_id: e.category_id,
    label: String(e.label || ""),
    value: String(e.value || ""),
    is_pinned: !!e.is_pinned,
    sort_order: e.sort_order ?? null,
  }));
}

function groupPageData(group: any, idx: Index) {
  const parent = group.parent_group_id ? idx.groupsById.get(group.parent_group_id) : null;
  const members = (idx.membershipsByGroup.get(group.id) || [])
    .filter((m) => !m.archived_at)
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
    .map((m) => ({ membership: m, contact: idx.contactsById.get(m.contact_id) }))
    .filter(({ contact }) => contact && !contact.merged_into)
    .map(({ membership, contact }) => ({
      name: String(contact.name),
      status: membership.status ?? null,
      priority: membership.priority ?? null,
      reason: membership.reason ?? null,
    }));
  return {
    group,
    parentName: parent && !parent.is_trashed ? String(parent.name) : null,
    members,
  };
}

// ─── Export ──────────────────────────────────────────────────────────

async function resolveCollisionSafeEntityPath(
  db: DbClient,
  userId: string,
  gh: GhCtx,
  desiredPath: string,
  entityType: string,
  entityId: string,
): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? desiredPath : incrementPath(desiredPath, i + 1);
    const { data: pathOwner } = await db
      .from("github_sync_log")
      .select("id, entity_type, entity_id")
      .eq("user_id", userId)
      .eq("github_path", candidate)
      .maybeSingle();
    if (pathOwner && !(pathOwner.entity_type === entityType && pathOwner.entity_id === entityId)) continue;
    const remoteFile = await githubGetFile(gh.token, gh.owner, gh.repo, candidate, gh.branch);
    if (!remoteFile) return candidate;
    const content = (await githubGetFileContent(gh.token, gh.owner, gh.repo, candidate, gh.branch)) || "";
    if (content.includes(`id: ${entityId}`) || content.includes(`id: "${entityId}"`)) return candidate;
  }
  throw new Error(`Could not find a free GitHub path for ${entityType} ${entityId}`);
}

async function exportEntityFile(
  db: DbClient,
  userId: string,
  gh: GhCtx,
  entityType: "person" | "group",
  entityId: string,
  name: string,
  content: string,
  syncRow: any | null,
): Promise<{ path: string }> {
  const desiredPath = entityType === "person"
    ? buildPersonPath(gh.vaultPath, name)
    : buildGroupPath(gh.vaultPath, name);

  let filePath = syncRow?.github_path || desiredPath;
  if (!syncRow || !pathMatchesName(syncRow.github_path, name)) {
    filePath = await resolveCollisionSafeEntityPath(db, userId, gh, desiredPath, entityType, entityId);
    if (syncRow?.github_path && syncRow.github_path !== filePath) {
      const oldFile = await githubGetFile(gh.token, gh.owner, gh.repo, syncRow.github_path, gh.branch);
      if (oldFile?.sha) {
        await githubDeleteFile(gh.token, gh.owner, gh.repo, syncRow.github_path, oldFile.sha, `Rename: ${name}`, gh.branch);
      }
    }
  }

  const existing = await githubGetFile(gh.token, gh.owner, gh.repo, filePath, gh.branch);

  // Skip the commit when only the informational `modified:` line changed —
  // timestamp-only updates (e.g. last_viewed_at touches) must not spam the
  // repo history. The sync row is still refreshed so the entity stops
  // counting as dirty.
  let sha = existing?.sha || null;
  let commitSha: string | null = null;
  const existingContent = existing?.content
    ? decodeURIComponent(escape(atob(String(existing.content).replace(/\n/g, ""))))
    : null;
  if (existingContent === null || !contentEffectivelyEqual(existingContent, content)) {
    const result = await githubPutFile(
      gh.token, gh.owner, gh.repo, filePath, content,
      `${syncRow ? "Update" : "Create"}: ${name}`, gh.branch, existing?.sha,
    );
    sha = result.content?.sha || null;
    commitSha = result.commit?.sha || null;
  }

  await db.from("github_sync_log").upsert({
    user_id: userId,
    note_id: null,
    entity_type: entityType,
    entity_id: entityId,
    github_path: filePath,
    github_sha: sha,
    ...(commitSha ? { last_commit_sha: commitSha } : {}),
    sync_status: "synced",
    sync_direction: "export",
    error_message: null,
    synced_at: new Date().toISOString(),
  }, { onConflict: "user_id,entity_type,entity_id" });

  return { path: filePath };
}

async function markEntityError(
  db: DbClient,
  userId: string,
  entityType: string,
  entityId: string,
  githubPath: string,
  message: string,
) {
  await db.from("github_sync_log").upsert({
    user_id: userId,
    note_id: null,
    entity_type: entityType,
    entity_id: entityId,
    github_path: githubPath,
    sync_status: "error",
    error_message: message,
    synced_at: new Date().toISOString(),
  }, { onConflict: "user_id,entity_type,entity_id" });
}

export interface SweepOptions {
  bulk?: boolean;
  forcePeople?: string[];
  forceGroups?: string[];
}

export interface SweepResult {
  exported_people: number;
  exported_groups: number;
  retired: number;
  errors: number;
  details: any[];
}

export async function sweepPeopleExport(
  db: DbClient,
  userId: string,
  gh: GhCtx,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const data = await loadPeopleData(db, userId);
  const idx = indexData(data);
  const result: SweepResult = { exported_people: 0, exported_groups: 0, retired: 0, errors: 0, details: [] };

  const forceGroups = new Set(opts.forceGroups || []);
  const forcePeople = new Set(opts.forcePeople || []);

  // 1. Retire pass: tracked entities that no longer exist (hard-deleted
  // contact), were merged away, or were trashed → delete the mirrored file.
  for (const row of data.syncRows) {
    let retire = false;
    if (row.entity_type === "person") {
      const contact = idx.contactsById.get(row.entity_id);
      retire = !contact || !!contact.merged_into;
      if (retire && contact) {
        for (const m of idx.membershipsByContact.get(contact.id) || []) forceGroups.add(m.group_id);
      }
    } else if (row.entity_type === "group") {
      const group = idx.groupsById.get(row.entity_id);
      retire = !group || !!group.is_trashed;
      if (retire) {
        for (const m of idx.membershipsByGroup.get(row.entity_id) || []) forcePeople.add(m.contact_id);
      }
    }
    if (!retire) continue;
    try {
      const file = await githubGetFile(gh.token, gh.owner, gh.repo, row.github_path, gh.branch);
      if (file?.sha) {
        await githubDeleteFile(gh.token, gh.owner, gh.repo, row.github_path, file.sha, `Remove: ${row.github_path}`, gh.branch);
      }
      await db.from("github_sync_log").delete().eq("id", row.id);
      idx.syncByEntity.delete(entityKey(row.entity_type, row.entity_id));
      result.retired++;
      result.details.push({ path: row.github_path, action: "retired", entity_type: row.entity_type });
    } catch (err) {
      result.errors++;
      result.details.push({ path: row.github_path, action: "retire_error", error: String(err) });
    }
  }

  // 2. Dirty detection.
  const liveGroups = data.groups.filter((g) => !g.is_trashed);
  const liveContacts = data.contacts.filter((c) => !c.merged_into);

  const dirtyGroups = new Set<string>();
  const dirtyPeople = new Set<string>();

  for (const g of liveGroups) {
    const row = idx.syncByEntity.get(entityKey("group", g.id));
    if (row?.sync_status === "conflict") continue;
    if (opts.bulk || !row || !row.synced_at || forceGroups.has(g.id) || groupClusterUpdatedAt(g, idx) > ts(row.synced_at)) {
      dirtyGroups.add(g.id);
    }
  }
  for (const c of liveContacts) {
    const row = idx.syncByEntity.get(entityKey("person", c.id));
    if (row?.sync_status === "conflict") continue;
    if (opts.bulk || !row || !row.synced_at || forcePeople.has(c.id) || personClusterUpdatedAt(c, idx) > ts(row.synced_at)) {
      dirtyPeople.add(c.id);
    }
  }

  // 3. Rename cascades: a renamed group must refresh its members' `groups:`
  // lists and its children's `parent:` line; a renamed person must refresh the
  // member tables of their groups.
  for (const gid of [...dirtyGroups]) {
    const g = idx.groupsById.get(gid);
    const row = idx.syncByEntity.get(entityKey("group", gid));
    if (!g || !row || pathMatchesName(row.github_path, String(g.name))) continue;
    for (const m of idx.membershipsByGroup.get(gid) || []) {
      if (!m.archived_at) dirtyPeople.add(m.contact_id);
    }
    for (const child of liveGroups) {
      if (child.parent_group_id === gid) dirtyGroups.add(child.id);
    }
  }
  for (const pid of [...dirtyPeople]) {
    const c = idx.contactsById.get(pid);
    const row = idx.syncByEntity.get(entityKey("person", pid));
    if (!c || !row || pathMatchesName(row.github_path, String(c.name))) continue;
    for (const m of idx.membershipsByContact.get(pid) || []) {
      if (!m.archived_at) dirtyGroups.add(m.group_id);
    }
  }

  // 4. Export groups, then people.
  for (const gid of dirtyGroups) {
    const g = idx.groupsById.get(gid);
    if (!g || g.is_trashed) continue;
    const row = idx.syncByEntity.get(entityKey("group", gid));
    if (row?.sync_status === "conflict") continue;
    try {
      const content = buildGroupMarkdown(groupPageData(g, idx));
      const { path } = await exportEntityFile(db, userId, gh, "group", gid, String(g.name), content, row || null);
      result.exported_groups++;
      result.details.push({ path, action: "exported", entity_type: "group" });
    } catch (err) {
      result.errors++;
      await markEntityError(db, userId, "group", gid, row?.github_path || buildGroupPath(gh.vaultPath, String(g.name)), String(err));
      result.details.push({ action: "export_error", entity_type: "group", entity_id: gid, error: String(err) });
    }
  }
  for (const pid of dirtyPeople) {
    const c = idx.contactsById.get(pid);
    if (!c || c.merged_into) continue;
    const row = idx.syncByEntity.get(entityKey("person", pid));
    if (row?.sync_status === "conflict") continue;
    try {
      const content = buildPersonMarkdown(personPageData(c, idx));
      const { path } = await exportEntityFile(db, userId, gh, "person", pid, String(c.name), content, row || null);
      result.exported_people++;
      result.details.push({ path, action: "exported", entity_type: "person" });
    } catch (err) {
      result.errors++;
      await markEntityError(db, userId, "person", pid, row?.github_path || buildPersonPath(gh.vaultPath, String(c.name)), String(err));
      result.details.push({ action: "export_error", entity_type: "person", entity_id: pid, error: String(err) });
    }
  }

  return result;
}

// ─── Pull (remote → DB) ──────────────────────────────────────────────

async function resolveGroupByName(
  db: DbClient,
  userId: string,
  name: string,
  idx: Index,
): Promise<any | null> {
  const key = normalizeName(name);
  for (const g of idx.groupsById.values()) {
    if (g.is_trashed) continue;
    if (normalizeName(String(g.name)) === key || normalizeName(String(g.slug || "")) === key) return g;
  }
  return null;
}

async function createGroupFromName(db: DbClient, userId: string, name: string, idx: Index): Promise<any> {
  const baseSlug = slugify(name);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const { data, error } = await db
      .from("contact_groups")
      .insert({ user_id: userId, name, slug, type: "other" })
      .select("*")
      .single();
    if (!error) {
      idx.groupsById.set(data.id, data);
      return data;
    }
    if ((error as { code?: string }).code === "23505") { lastError = error; continue; }
    throw error;
  }
  throw lastError ?? new Error(`Could not create group "${name}"`);
}

function firstStageId(group: any): string | null {
  const stages = Array.isArray(group?.stages) ? group.stages : [];
  const first = stages[0];
  return first && typeof first === "object" && "id" in first ? String((first as { id: unknown }).id) : null;
}

/**
 * Apply a parsed person page to the DB. Membership set-diff runs only when the
 * `groups:` key was present; removals archive, additions get the group's first
 * stage. Returns the group ids whose member tables changed.
 */
export async function applyRemotePerson(
  db: DbClient,
  userId: string,
  contact: any,
  parsed: ParsedPersonFile,
  idx: Index,
): Promise<string[]> {
  const updates: Record<string, unknown> = {};
  if (parsed.name && parsed.name !== contact.name) updates.name = parsed.name;
  for (const field of ["company", "role", "relationship", "email", "phone"] as const) {
    const value = parsed.core[field];
    if (value !== undefined && value !== (contact[field] ?? null)) updates[field] = value;
  }
  if (parsed.tags !== null) updates.tags = parsed.tags;
  if (parsed.aliases !== null) updates.aliases = parsed.aliases;
  if (parsed.favorite !== null && parsed.favorite !== !!contact.is_favorite) updates.is_favorite = parsed.favorite;
  if (parsed.sensitive !== null && parsed.sensitive !== !!contact.is_sensitive) updates.is_sensitive = parsed.sensitive;
  const newNotes = parsed.notesBody.trim() || null;
  if (newNotes !== (contact.notes ?? null)) updates.notes = newNotes;

  if (Object.keys(updates).length > 0) {
    const { error } = await db.from("contacts").update(updates).eq("id", contact.id).eq("user_id", userId);
    if (error) throw new Error(`Failed to update contact: ${error.message}`);
  }

  const touchedGroups: string[] = [];
  if (parsed.groups !== null) {
    const desiredIds = new Set<string>();
    for (const groupName of parsed.groups) {
      let group = await resolveGroupByName(db, userId, groupName, idx);
      if (!group) group = await createGroupFromName(db, userId, groupName, idx);
      desiredIds.add(group.id);
    }

    const current = (idx.membershipsByContact.get(contact.id) || []).filter((m) => !m.archived_at);
    const currentByGroup = new Map<string, any>(current.map((m) => [m.group_id, m]));

    for (const gid of desiredIds) {
      if (currentByGroup.has(gid)) continue;
      const group = idx.groupsById.get(gid);
      const { error } = await db.from("contact_group_memberships").insert({
        user_id: userId,
        group_id: gid,
        contact_id: contact.id,
        status: firstStageId(group),
        priority: "normal",
      });
      // 23505 = already a member (e.g. archived row got un-archived elsewhere) — not fatal.
      if (error && (error as { code?: string }).code !== "23505") {
        throw new Error(`Failed to add membership: ${error.message}`);
      }
      touchedGroups.push(gid);
    }
    for (const [gid, membership] of currentByGroup) {
      const group = idx.groupsById.get(gid);
      // Only live groups are represented in `groups:` — never archive
      // memberships of trashed groups based on their absence from the list.
      if (!group || group.is_trashed || desiredIds.has(gid)) continue;
      const { error } = await db
        .from("contact_group_memberships")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", membership.id)
        .eq("user_id", userId);
      if (error) throw new Error(`Failed to archive membership: ${error.message}`);
      touchedGroups.push(gid);
    }
  }

  return touchedGroups;
}

/** Apply a parsed group page. Validates everything before writing anything. */
export async function applyRemoteGroup(
  db: DbClient,
  userId: string,
  group: any,
  parsed: ParsedGroupFile,
  idx: Index,
): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (parsed.groupType !== null) {
    if (!GROUP_TYPES.includes(parsed.groupType)) {
      throw new VaultParseError(`Invalid group_type "${parsed.groupType}" — allowed: ${GROUP_TYPES.join(", ")}`);
    }
    if (parsed.groupType !== group.type) updates.type = parsed.groupType;
  }
  if (parsed.sensitivity !== null) {
    if (!["normal", "sensitive"].includes(parsed.sensitivity)) {
      throw new VaultParseError(`Invalid sensitivity "${parsed.sensitivity}" — allowed: normal, sensitive`);
    }
    if (parsed.sensitivity !== group.sensitivity) updates.sensitivity = parsed.sensitivity;
  }
  if (parsed.parent !== undefined) {
    if (parsed.parent === null) {
      if (group.parent_group_id) updates.parent_group_id = null;
    } else {
      const parent = await resolveGroupByName(db, userId, parsed.parent, idx);
      if (!parent) throw new VaultParseError(`Parent group "${parsed.parent}" not found`);
      if (parent.id === group.id) throw new VaultParseError("A group cannot be its own parent");
      if (parent.id !== group.parent_group_id) updates.parent_group_id = parent.id;
    }
  }
  if (parsed.name && parsed.name !== group.name) updates.name = parsed.name;
  if (parsed.purpose !== (group.purpose ?? "") && !(parsed.purpose === "" && group.purpose == null)) {
    updates.purpose = parsed.purpose || null;
  }
  if (parsed.description !== (group.description ?? "") && !(parsed.description === "" && group.description == null)) {
    updates.description = parsed.description || null;
  }

  if (Object.keys(updates).length === 0) return;
  const { error } = await db.from("contact_groups").update(updates).eq("id", group.id).eq("user_id", userId);
  // The parent-cycle guard trigger RAISEs on cycles; surface it as a parse-level error.
  if (error) throw new VaultParseError(`Failed to update group: ${error.message}`);
}

/** Regenerate the canonical page from fresh DB state, push it, mark synced. */
async function regenerateAndPush(
  db: DbClient,
  userId: string,
  gh: GhCtx,
  entityType: "person" | "group",
  entityId: string,
): Promise<void> {
  const data = await loadPeopleData(db, userId);
  const idx = indexData(data);
  if (entityType === "person") {
    const contact = idx.contactsById.get(entityId);
    if (!contact) return;
    const content = buildPersonMarkdown(personPageData(contact, idx));
    const row = idx.syncByEntity.get(entityKey("person", entityId));
    await exportEntityFile(db, userId, gh, "person", entityId, String(contact.name), content, row || null);
  } else {
    const group = idx.groupsById.get(entityId);
    if (!group) return;
    const content = buildGroupMarkdown(groupPageData(group, idx));
    const row = idx.syncByEntity.get(entityKey("group", entityId));
    await exportEntityFile(db, userId, gh, "group", entityId, String(group.name), content, row || null);
  }
}

export interface PullArgs {
  /** Every markdown blob in scope: path → { path, sha }. */
  remoteByPath: Map<string, { path: string; sha: string }>;
  /** All sync-log paths already tracked (notes AND entities). */
  trackedPaths: Set<string>;
}

export interface PullCounters {
  people_pulled: number;
  people_conflicts: number;
  people_imported: number;
  people_deleted_remote: number;
  groups_pulled: number;
  groups_conflicts: number;
  groups_imported: number;
  groups_deleted_remote: number;
  errors: number;
  details: any[];
}

export function vaultPrefixes(vaultPath: string): { people: string; groups: string } {
  const base = normalizePathPart(vaultPath);
  return {
    people: base ? `${base}/${PEOPLE_DIR}/` : `${PEOPLE_DIR}/`,
    groups: base ? `${base}/${GROUPS_DIR}/` : `${GROUPS_DIR}/`,
  };
}

export async function pullPeopleAndGroups(
  db: DbClient,
  userId: string,
  gh: GhCtx,
  args: PullArgs,
): Promise<PullCounters> {
  const counters: PullCounters = {
    people_pulled: 0, people_conflicts: 0, people_imported: 0, people_deleted_remote: 0,
    groups_pulled: 0, groups_conflicts: 0, groups_imported: 0, groups_deleted_remote: 0,
    errors: 0, details: [],
  };

  const data = await loadPeopleData(db, userId);
  const idx = indexData(data);
  const prefixes = vaultPrefixes(gh.vaultPath);

  // Entities whose tracked file vanished; resolved rename candidates (new
  // files carrying the same frontmatter id) clear them before we write
  // remote_deleted at the end.
  const pendingRemoteDeleted = new Map<string, any>();

  // 1. Tracked entity files — groups first, then people.
  const rank = (r: any) => (r.entity_type === "group" ? 0 : 1);
  const orderedRows = [...data.syncRows].sort((a, b) => rank(a) - rank(b));
  for (const row of orderedRows) {
    const isGroup = row.entity_type === "group";
    const entity = isGroup ? idx.groupsById.get(row.entity_id) : idx.contactsById.get(row.entity_id);
    if (!entity || (isGroup ? entity.is_trashed : entity.merged_into)) continue; // sweep retires these

    const remote = args.remoteByPath.get(row.github_path);
    if (!remote) {
      pendingRemoteDeleted.set(entityKey(row.entity_type, row.entity_id), row);
      continue;
    }
    if (remote.sha === row.github_sha) continue;

    const clusterUpdated = isGroup ? groupClusterUpdatedAt(entity, idx) : personClusterUpdatedAt(entity, idx);
    const localChanged = row.synced_at && clusterUpdated > ts(row.synced_at);

    if (localChanged) {
      await db.from("github_sync_log").update({
        sync_status: "conflict",
        github_sha: remote.sha,
        error_message: "Both local and remote were modified since last sync",
      }).eq("id", row.id);
      if (isGroup) counters.groups_conflicts++; else counters.people_conflicts++;
      counters.details.push({ path: row.github_path, action: "conflict", entity_type: row.entity_type });
      continue;
    }

    try {
      const content = await githubGetFileContent(gh.token, gh.owner, gh.repo, row.github_path, gh.branch);
      if (!content) { counters.errors++; continue; }
      if (isGroup) {
        const parsed = parseGroupMarkdown(content, { requireMarkers: true });
        await applyRemoteGroup(db, userId, entity, parsed, idx);
        await regenerateAndPush(db, userId, gh, "group", entity.id);
        counters.groups_pulled++;
      } else {
        const parsed = parsePersonMarkdown(content, { requireMarkers: true });
        const touchedGroups = await applyRemotePerson(db, userId, entity, parsed, idx);
        await regenerateAndPush(db, userId, gh, "person", entity.id);
        for (const gid of touchedGroups) await regenerateAndPush(db, userId, gh, "group", gid);
        counters.people_pulled++;
      }
      counters.details.push({ path: row.github_path, action: "pulled", entity_type: row.entity_type });
    } catch (err) {
      const message = err instanceof VaultParseError ? err.message : String(err);
      await db.from("github_sync_log").update({
        sync_status: "error",
        error_message: message,
      }).eq("id", row.id);
      counters.errors++;
      counters.details.push({ path: row.github_path, action: "error", entity_type: row.entity_type, error: message });
    }
  }

  // 2. New untracked files under Groups/ then People/.
  const newGroupPaths: string[] = [];
  const newPeoplePaths: string[] = [];
  for (const path of args.remoteByPath.keys()) {
    if (args.trackedPaths.has(path)) continue;
    if (path.startsWith(prefixes.groups)) newGroupPaths.push(path);
    else if (path.startsWith(prefixes.people)) newPeoplePaths.push(path);
  }

  for (const path of newGroupPaths) {
    try {
      const remote = args.remoteByPath.get(path)!;
      const content = await githubGetFileContent(gh.token, gh.owner, gh.repo, path, gh.branch);
      if (!content) { counters.errors++; continue; }
      const parsed = parseGroupMarkdown(content, { requireMarkers: false });
      const fileName = (path.split("/").pop() || "").replace(/\.md$/i, "");
      const name = parsed.name || fileName;

      let group = parsed.id ? idx.groupsById.get(parsed.id) : null;
      if (!group) group = await resolveGroupByName(db, userId, name, idx);

      if (group && !group.is_trashed) {
        // Rename/move or first-time bind of an existing group.
        const row = idx.syncByEntity.get(entityKey("group", group.id));
        if (row) {
          await db.from("github_sync_log").update({ github_path: path, github_sha: remote.sha }).eq("id", row.id);
          row.github_path = path;
          row.github_sha = remote.sha;
        }
        pendingRemoteDeleted.delete(entityKey("group", group.id));
        await applyRemoteGroup(db, userId, group, parsed, idx);
        await regenerateAndPush(db, userId, gh, "group", group.id);
        counters.groups_pulled++;
        counters.details.push({ path, action: "rebound", entity_type: "group" });
      } else {
        const created = await createGroupFromName(db, userId, name, idx);
        await applyRemoteGroup(db, userId, created, parsed, idx);
        await regenerateAndPush(db, userId, gh, "group", created.id);
        counters.groups_imported++;
        counters.details.push({ path, action: "new_import", entity_type: "group" });
      }
    } catch (err) {
      counters.errors++;
      counters.details.push({ path, action: "error", entity_type: "group", error: String(err) });
    }
  }

  // Re-index after group imports so person binding sees new groups.
  const dataAfterGroups = await loadPeopleData(db, userId);
  const idx2 = indexData(dataAfterGroups);

  for (const path of newPeoplePaths) {
    try {
      const remote = args.remoteByPath.get(path)!;
      const content = await githubGetFileContent(gh.token, gh.owner, gh.repo, path, gh.branch);
      if (!content) { counters.errors++; continue; }
      const parsed = parsePersonMarkdown(content, { requireMarkers: false });
      const fileName = (path.split("/").pop() || "").replace(/\.md$/i, "").replace(/ \d+$/, "");
      const name = parsed.name || fileName;

      let contact = parsed.id ? idx2.contactsById.get(parsed.id) : null;
      if (!contact) {
        // Fall back to unique normalized name/alias match among live contacts.
        const key = normalizeName(name);
        const matches = dataAfterGroups.contacts.filter((c) =>
          !c.merged_into &&
          (normalizeName(String(c.name)) === key ||
            (c.aliases || []).some((a: string) => normalizeName(a) === key)),
        );
        if (matches.length === 1) contact = matches[0];
      }

      if (contact && !contact.merged_into) {
        const row = idx2.syncByEntity.get(entityKey("person", contact.id));
        if (row) {
          await db.from("github_sync_log").update({ github_path: path, github_sha: remote.sha }).eq("id", row.id);
          row.github_path = path;
          row.github_sha = remote.sha;
        }
        pendingRemoteDeleted.delete(entityKey("person", contact.id));
        const touchedGroups = await applyRemotePerson(db, userId, contact, parsed, idx2);
        await regenerateAndPush(db, userId, gh, "person", contact.id);
        for (const gid of touchedGroups) await regenerateAndPush(db, userId, gh, "group", gid);
        counters.people_pulled++;
        counters.details.push({ path, action: "rebound", entity_type: "person" });
      } else {
        const { data: created, error } = await db.from("contacts").insert({
          user_id: userId,
          name,
          metadata: { imported_from: "obsidian", original_path: path },
        }).select("*").single();
        if (error) throw new Error(`Failed to create contact: ${error.message}`);
        idx2.contactsById.set(created.id, created);
        const touchedGroups = await applyRemotePerson(db, userId, created, parsed, idx2);
        await regenerateAndPush(db, userId, gh, "person", created.id);
        for (const gid of touchedGroups) await regenerateAndPush(db, userId, gh, "group", gid);
        counters.people_imported++;
        counters.details.push({ path, action: "new_import", entity_type: "person" });
      }
    } catch (err) {
      counters.errors++;
      counters.details.push({ path, action: "error", entity_type: "person", error: String(err) });
    }
  }

  // 3. Finalize remote deletions that no rename candidate claimed.
  for (const row of pendingRemoteDeleted.values()) {
    await db.from("github_sync_log").update({ sync_status: "remote_deleted" }).eq("id", row.id);
    if (row.entity_type === "group") counters.groups_deleted_remote++;
    else counters.people_deleted_remote++;
    counters.details.push({ path: row.github_path, action: "remote_deleted", entity_type: row.entity_type });
  }

  return counters;
}

// ─── Conflict resolution ─────────────────────────────────────────────

export async function resolveEntityConflict(
  db: DbClient,
  userId: string,
  gh: GhCtx,
  entityType: "person" | "group",
  entityId: string,
  resolution: "keep_local" | "keep_remote",
): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await db
    .from("github_sync_log")
    .select("*")
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Sync entry not found" };

  if (resolution === "keep_local") {
    // Mark synced first so exportEntityFile's guard doesn't skip; regenerate
    // pushes the canonical DB state over the remote copy.
    await db.from("github_sync_log").update({ sync_status: "synced", error_message: null }).eq("id", row.id);
    await regenerateAndPush(db, userId, gh, entityType, entityId);
    return { ok: true };
  }

  // keep_remote
  const content = await githubGetFileContent(gh.token, gh.owner, gh.repo, row.github_path, gh.branch);
  if (!content) return { ok: false, error: "Failed to fetch remote file" };

  const data = await loadPeopleData(db, userId);
  const idx = indexData(data);
  try {
    if (entityType === "group") {
      const group = idx.groupsById.get(entityId);
      if (!group) return { ok: false, error: "Group not found" };
      const parsed = parseGroupMarkdown(content, { requireMarkers: true });
      await applyRemoteGroup(db, userId, group, parsed, idx);
    } else {
      const contact = idx.contactsById.get(entityId);
      if (!contact) return { ok: false, error: "Contact not found" };
      const parsed = parsePersonMarkdown(content, { requireMarkers: true });
      await applyRemotePerson(db, userId, contact, parsed, idx);
    }
  } catch (err) {
    const message = err instanceof VaultParseError ? err.message : String(err);
    await db.from("github_sync_log").update({ sync_status: "error", error_message: message }).eq("id", row.id);
    return { ok: false, error: message };
  }
  await db.from("github_sync_log").update({ sync_status: "synced", error_message: null }).eq("id", row.id);
  await regenerateAndPush(db, userId, gh, entityType, entityId);
  return { ok: true };
}
