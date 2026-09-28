// Live-schema rehearsal of the fact store switch (docs/plans/one-fact-store.md, A5).
//
// Needs a local Postgres built from the live schema by
// scripts/rehearsal/build-local-db.sh, with its database renamed to the template
// `live_tpl` (the script's --template flag does that). Every scenario copies
// the template, loads the invented fixture (scripts/bootstrap-fact-store-test.sql),
// builds the label map with the same TypeScript the edge function uses, and runs
// the real migration and rollback files.
//
//   FACT_TEST_PGHOST=/var/tmp/menerio-fact-pg node scripts/test-fact-store.mjs
//
// Local only: refuses any host that is not a socket directory or localhost.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { buildFactLabelMap } from '../supabase/functions/_shared/fact-label-map.ts';

const host = process.env.FACT_TEST_PGHOST;
const port = Number(process.env.FACT_TEST_PGPORT ?? 55432);
if (!host) throw Error('Set FACT_TEST_PGHOST to the local rehearsal database (socket dir or localhost)');
if (!host.startsWith('/') && !['localhost', '127.0.0.1', '[::1]'].includes(host)) throw Error('Local database only');

const root = new URL('../', import.meta.url);
const file = (p) => readFile(new URL(p, root), 'utf8');
const SQL = {
  inputs: await file('supabase/migrations/20260929090000_fact_store_inputs.sql'),
  schema: await file('supabase/migrations/20260929090100_fact_store_schema.sql'),
  switch: await file('supabase/migrations/20260929090200_fact_store_switch.sql'),
  backup: await file('supabase/rollback/fact_store_backup.sql'),
  rollback: await file('supabase/rollback/fact_store_rollback.sql'),
  fixture: await file('scripts/bootstrap-fact-store-test.sql'),
};

const U = '10000000-0000-0000-0000-000000000001';
const U2 = '10000000-0000-0000-0000-000000000002';
const A = 'a0000000-0000-0000-0000-000000000001', H = 'a0000000-0000-0000-0000-000000000002';
const P = 'a0000000-0000-0000-0000-000000000003', SC = 'a0000000-0000-0000-0000-000000000004';
const M1 = 'a0000000-0000-0000-0000-000000000005', M2 = 'a0000000-0000-0000-0000-000000000006';
const D = 'a0000000-0000-0000-0000-000000000007';
const c = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const b = (n) => `b0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const d = (n) => `d0000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const HUMAN = { role: 'authenticated', sub: U };
const MACHINE = { role: 'service_role' };

const admin = new pg.Client({ host, port, user: 'postgres', database: 'postgres' });
await admin.connect();

async function freshDb(name) {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name} TEMPLATE live_tpl`);
  const db = new pg.Client({ host, port, user: 'postgres', database: name });
  await db.connect();
  return db;
}

async function buildLabelMap(db) {
  const labels = (await db.query('SELECT DISTINCT label FROM public.profile_entries')).rows.map((r) => r.label);
  const attributes = (await db.query('SELECT DISTINCT attribute FROM public.claims')).rows.map((r) => r.attribute);
  await db.query('DELETE FROM public.fact_label_map');
  for (const r of buildFactLabelMap(labels, attributes)) {
    await db.query('INSERT INTO public.fact_label_map VALUES ($1,$2,$3,$4,$5)', [r.kind, r.key, r.attribute, r.label, r.category_slug]);
  }
}

/** Run one file as one transaction, like the management API runner does. */
async function applyTx(db, sql, after) {
  await db.query('BEGIN');
  try {
    await db.query(sql);
    const out = after ? await after() : undefined;
    await db.query('COMMIT');
    return out;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

async function runSwitch(db) {
  return applyTx(db, SQL.switch, async () =>
    Object.fromEntries((await db.query('SELECT step, n FROM fact_switch_report ORDER BY step')).rows.map((r) => [r.step, Number(r.n)])));
}

/** Run fn as a caller (JWT claims + role) inside a transaction that is rolled back. */
async function as(db, who, fn, { keep = false } = {}) {
  await db.query('BEGIN');
  try {
    if (who) {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(who)]);
      await db.query(`SET LOCAL ROLE ${who.role}`);
    }
    const out = await fn();
    await db.query(keep ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const num = async (db, sql, params = []) => Number(await val(db, sql, params));

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name, 'ok']);
  } catch (e) {
    results.push([name, 'FAIL', e.message]);
  }
}
async function rejects(fn, pattern) {
  try {
    await fn();
  } catch (e) {
    assert.match(e.message, pattern);
    return;
  }
  assert.fail(`expected an error matching ${pattern}`);
}

async function prepared(name) {
  const db = await freshDb(name);
  await applyTx(db, SQL.inputs);
  await applyTx(db, SQL.fixture);
  await buildLabelMap(db);
  return db;
}

// ---------------------------------------------------------------- main scenario
const db = await prepared('fs_main');
await applyTx(db, SQL.backup);
await applyTx(db, SQL.schema);
let report;
await test('switch commits on the fixture', async () => { report = await runSwitch(db); });
if (!report) {
  console.log(results.map((r) => r.join('  ')).join('\n'));
  process.exit(1);
}

await test('report counts', async () => {
  assert.equal(report.step4_folded_duplicates, 1);
  assert.equal(report.step7_unshown_dropped, 4);
  assert.equal(report.step7_dropped_listed, 1);
  assert.equal(report.step7_dropped_placeholder, 1);
  assert.equal(report.step7_dropped_already_shown, 1);
  assert.equal(report.step7_dropped_no_source, 1);
  assert.equal(report.step7b_two_answers_older_made_history, 1);
  assert.equal(report.step7b_two_answers_kept_as_several, 1);
  assert.equal(report.after_two_answers_slots, 0);
  assert.equal(report.step5_entries_closed, 1);
  assert.equal(report.step5_inserted_differs, 2);   // Hometown (typo) and Employer (other subject)
  assert.equal(report.step5_folded_into_existing, 3); // City→Hometown's claim, Hobby, Pet
  assert.equal(report.after_claims, report.before_claims - 1 - report.step7_unshown_dropped + report.step5_inserted_differs + report.step5_inserted_unlinked);
});

await test('linked, equal: kept and made preferred', async () => {
  const r = await one(db, 'SELECT rank, value FROM claims WHERE id=$1', [c(1)]);
  assert.deepEqual(r, { rank: 'preferred', value: 'German' });
  assert.equal(await val(db, 'SELECT derived_from_claim_id FROM profile_entries_archive WHERE id=$1', [b(1)]), c(1));
});
await test('linked, words differ: the page\'s words win, the claim\'s other wording becomes history', async () => {
  const r = await one(db, 'SELECT value, attribute, subject_type FROM claims WHERE id=$1', [b(2)]);
  assert.deepEqual(r, { value: 'Berlin', attribute: 'city', subject_type: 'self' });
  assert.equal(await val(db, 'SELECT derived_from_claim_id FROM profile_entries_archive WHERE id=$1', [b(3)]), b(2));
  assert.equal(await num(db, `SELECT count(*) FROM profile_facts WHERE user_id=$1 AND subject_type='self' AND attribute='city' AND is_current`, [U]), 1);
  assert.equal(await val(db, 'SELECT is_current FROM profile_facts WHERE claim_id=$1', [c(2)]), false);
  assert.equal(await num(db, 'SELECT count(*) FROM profile_facts WHERE has_conflict AND is_current'), 0);
});
await test('linked to another subject: a self claim, the contact claim stays', async () => {
  const r = await one(db, 'SELECT subject_type, rank, origin FROM claims WHERE id=$1', [b(4)]);
  assert.deepEqual(r, { subject_type: 'self', rank: 'preferred', origin: 'user_manual' });
  assert.equal(await val(db, 'SELECT subject_id FROM claims WHERE id=$1', [c(3)]), SC);
});
await test('linked to a closed claim: history, not current', async () => {
  assert.equal(await val(db, 'SELECT is_current FROM profile_facts WHERE claim_id=$1', [c(4)]), false);
});
await test('unlinked: a claim with the entry id, words, origin and quote', async () => {
  const r = await one(db, 'SELECT value, origin, evidence_quote IS NOT NULL AS quoted, valid_from FROM claims WHERE id=$1', [b(6)]);
  assert.deepEqual(r, { value: 'Pasta', origin: 'ai_note', quoted: true, valid_from: null });
  assert.equal(await val(db, 'SELECT is_pinned FROM fact_slots WHERE subject_id=$1 AND attribute=$2', [A, 'favourite-food']), true);
});
await test('folded into an existing value, a human entry makes it preferred', async () => {
  assert.equal(await val(db, 'SELECT derived_from_claim_id FROM profile_entries_archive WHERE id=$1', [b(7)]), c(5));
  assert.equal(await val(db, 'SELECT derived_from_claim_id FROM profile_entries_archive WHERE id=$1', [b(8)]), c(6));
  assert.equal(await val(db, 'SELECT rank FROM claims WHERE id=$1', [c(6)]), 'preferred');
});
await test('hidden contact carried over, not seen by assistants', async () => {
  assert.equal(await val(db, 'SELECT subject_id FROM claims WHERE id=$1', [b(9)]), H);
  assert.equal(await num(db, 'SELECT count(*) FROM agent_facts WHERE claim_id=$1', [b(9)]), 0);
});
await test('reserved label, bag, legacy unverified and "none" rows carried as they are', async () => {
  assert.equal(await val(db, 'SELECT attribute FROM claims WHERE id=$1', [b(10)]), 'relationship-note');
  assert.equal(await val(db, 'SELECT value FROM claims WHERE id=$1', [b(11)]), 'German, English, French');
  assert.equal(await val(db, 'SELECT origin FROM claims WHERE id=$1', [b(12)]), 'unverified');
  assert.equal(await val(db, 'SELECT value FROM claims WHERE id=$1', [b(13)]), 'none');
});
await test('an attribute split across a private and a public section becomes private', async () => {
  assert.equal(await val(db, `SELECT category_slug FROM fact_slots WHERE subject_id=$1 AND attribute='diagnosis'`, [P]), 'health');
  assert.equal(await num(db, `SELECT count(*) FROM profile_facts WHERE subject_id=$1 AND attribute='diagnosis' AND visibility_scope='private'`, [P]), 2);
  assert.equal(await num(db, `SELECT count(*) FROM agent_facts WHERE subject_id=$1`, [P]), 0);
  // The page listed both values, so the attribute keeps both instead of showing two answers.
  assert.equal(await val(db, `SELECT cardinality FROM fact_slots WHERE subject_id=$1 AND attribute='diagnosis'`, [P]), 'many');
});
await test('duplicate group folded to the human copy, its entry re-pointed', async () => {
  assert.equal(await num(db, 'SELECT count(*) FROM claims WHERE id=$1', [c(8)]), 0);
  assert.equal(await val(db, 'SELECT derived_from_claim_id FROM profile_entries_archive WHERE id=$1', [b(16)]), c(7));
  assert.equal(await val(db, 'SELECT rank FROM claims WHERE id=$1', [c(7)]), 'preferred');
});
await test('unshown claims: one kept with a slot, one dropped with a suppression', async () => {
  assert.equal(await num(db, `SELECT count(*) FROM fact_slots WHERE user_id=$1 AND subject_type='self' AND attribute='coffee'`, [U]), 1);
  assert.equal(await num(db, 'SELECT count(*) FROM claims WHERE id=$1', [c(10)]), 0);
  assert.equal(await num(db, `SELECT count(*) FROM ai_suggestion_suppressions WHERE suppression_key='self::tea:green'`), 1);
  assert.equal(await val(db, 'SELECT rank FROM claims WHERE id=$1', [c(11)]), 'preferred');
  assert.equal(await num(db, 'SELECT count(*) FROM claims WHERE id IN ($1,$2,$3)', [c(21), c(22), c(23)]), 0);
  assert.equal(await num(db, `SELECT count(*) FROM ai_suggestion_suppressions WHERE suggestion_type='claim' AND target_entity_id IN ($1,$2,$3)`, [c(21), c(22), c(23)]), 3);
});
await test('entities: no slot; the hidden one is not seen by assistants', async () => {
  assert.equal(await num(db, `SELECT count(*) FROM fact_slots WHERE subject_type='entity'`), 0);
  assert.equal(await num(db, 'SELECT count(*) FROM agent_facts WHERE claim_id=$1', [c(12)]), 1);
  assert.equal(await num(db, 'SELECT count(*) FROM agent_facts WHERE claim_id=$1', [c(13)]), 0);
});
await test('review items: re-pointed, folded not revertible, missing marked, normalize superseded', async () => {
  const r1 = await one(db, 'SELECT target_entity_type t, target_entity_id id, payload FROM review_queue WHERE id=$1', [d(1)]);
  assert.equal(r1.t, 'claim'); assert.equal(r1.id, b(6)); assert.equal(r1.payload.fact_store_switch.revertible, true);
  assert.equal((await val(db, 'SELECT payload FROM review_queue WHERE id=$1', [d(2)])).fact_store_switch.revertible, false);
  const r3 = await one(db, 'SELECT target_entity_type t, payload FROM review_queue WHERE id=$1', [d(3)]);
  assert.equal(r3.t, 'profile_entry'); assert.equal(r3.payload.fact_store_switch.entry_missing, true);
  assert.equal(await val(db, 'SELECT status FROM review_queue WHERE id=$1', [d(5)]), 'superseded');
  assert.equal(await val(db, 'SELECT payload FROM review_queue WHERE id=$1', [d(6)]).then((p) => p.fact_store_switch), undefined);
});
await test('world_claims: agent_facts plus relationships, no entry rows', async () => {
  assert.equal(await num(db, `SELECT count(*) FROM world_claims WHERE source_table='profile_entry'`), 0);
  assert.equal(await num(db, `SELECT count(*) FROM world_claims WHERE source_table='contact_relationship'`), 1);
  assert.equal(await num(db, `SELECT count(*) FROM world_claims WHERE subject_id IN ($1,$2) AND source_table='claim'`, [H, P]), 0);
});
await test('the old table is an archive nobody can write', async () => {
  assert.equal(await val(db, `SELECT to_regclass('public.profile_entries')`), null);
  await rejects(() => as(db, HUMAN, () => db.query('SELECT 1 FROM profile_entries_archive LIMIT 1')), /permission denied/);
  assert.equal(await num(db, `SELECT count(*) FROM pg_trigger WHERE tgrelid='profile_entries_archive'::regclass AND NOT tgisinternal AND tgenabled <> 'D'`), 0);
});

// ------------------------------------------------------------------ guards
await test('machine update of a preferred claim keeps its words and period', async () => {
  const r = await as(db, MACHINE, () => one(db, `UPDATE claims SET value='Spanish', valid_to=current_date WHERE id=$1 RETURNING value, valid_to, rank`, [c(1)]));
  assert.deepEqual(r, { value: 'German', valid_to: null, rank: 'preferred' });
});
await test('machine delete of a preferred claim is cancelled', async () => {
  assert.equal(await as(db, MACHINE, async () => { await db.query('DELETE FROM claims WHERE id=$1', [c(1)]); return num(db, 'SELECT count(*) FROM claims WHERE id=$1', [c(1)]); }), 1);
});
await test('human correction passes, becomes preferred and user_manual, clears the embedding', async () => {
  const r = await as(db, HUMAN, async () => {
    await db.query(`RESET ROLE`);
    await db.query(`UPDATE claims SET embedding = array_fill(0.1::real, ARRAY[1536])::extensions.vector WHERE id=$1`, [c(14)]);
    await db.query(`SET LOCAL ROLE authenticated`);
    return one(db, `UPDATE claims SET value='Head chef' WHERE id=$1 RETURNING rank, origin, embedding IS NULL AS cleared`, [c(14)]);
  });
  assert.deepEqual(r, { rank: 'preferred', origin: 'user_manual', cleared: true });
});
await test('a human only ending a machine claim does not make it the human\'s', async () => {
  const r = await as(db, HUMAN, () => one(db, `UPDATE claims SET valid_to=current_date WHERE id=$1 RETURNING rank, origin`, [c(5)]));
  assert.deepEqual(r, { rank: 'normal', origin: 'ai_note' });
});
await test('quality and origin guards raise on insert', async () => {
  await rejects(() => as(db, MACHINE, () => db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin, evidence_quote) VALUES ($1,'self','mood','none','ai_note','quoted enough text')`, [U])), /claim_quality_guard/);
  await rejects(() => as(db, MACHINE, () => db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin) VALUES ($1,'self','mood','happy','ai_note')`, [U])), /claim_evidence_required/);
  await rejects(() => as(db, MACHINE, () => db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin) VALUES ($1,'self','mood','happy','unverified')`, [U])), /reserved for legacy/);
});
await test('legacy rows can be ended and embedded without the guards raising', async () => {
  await as(db, MACHINE, async () => {
    await db.query(`UPDATE claims SET valid_to=current_date WHERE id=$1`, [b(12)]);
    await db.query(`UPDATE claims SET embedding = array_fill(0.1::real, ARRAY[1536])::extensions.vector WHERE id=$1`, [b(13)]);
  });
});
await test('a machine cannot insert its own fact as preferred', async () => {
  const r = await as(db, MACHINE, () => one(db, `INSERT INTO claims (user_id, subject_type, attribute, value, origin, evidence_quote, rank) VALUES ($1,'self','mood','calm','ai_note','I feel calm today.','preferred') RETURNING rank`, [U]));
  assert.equal(r.rank, 'normal');
});
await test('one live copy per value; history may repeat it; 5 KB values fit', async () => {
  await rejects(() => as(db, MACHINE, () => db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin) VALUES ($1,'self','language','german ','user_manual')`, [U])), /claims_one_live_value/);
  await as(db, HUMAN, async () => {
    await db.query(`UPDATE claims SET valid_to=current_date WHERE id=$1`, [c(1)]);
    await db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin) VALUES ($1,'self','language','German','user_manual')`, [U]);
    await db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin) VALUES ($1,'self','essay',repeat('x', 5000),'user_manual')`, [U]);
  });
});

// ------------------------------------------------------------------ views
await test('profile_facts as the owner: one row per claim; the other account sees only its own', async () => {
  const owned = await num(db, 'SELECT count(*) FROM claims WHERE user_id=$1', [U]);
  assert.equal(await as(db, HUMAN, () => num(db, 'SELECT count(*) FROM profile_facts')), owned);
  assert.equal(await as(db, { role: 'authenticated', sub: U2 }, () => num(db, 'SELECT count(*) FROM profile_facts WHERE user_id=$1', [U])), 0);
  await rejects(() => as(db, { role: 'anon' }, () => db.query('SELECT 1 FROM profile_facts')), /permission denied/);
});
await test('agent_facts hides private, hidden and sensitive rows', async () => {
  const r = await as(db, HUMAN, () => one(db, `SELECT count(*) FILTER (WHERE visibility_scope='private') p, count(*) FILTER (WHERE subject_id IN ($1,$2)) h FROM agent_facts`, [H, 'e0000000-0000-0000-0000-000000000002']));
  assert.deepEqual(r, { p: '0', h: '0' });
});
await test('a future-dated value is not current and raises no conflict; "both are true" clears the badge', async () => {
  await as(db, HUMAN, async () => {
    // coffee has one current value; a change dated next month is not a second answer yet.
    await db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin, valid_from) VALUES ($1,'self','coffee','Latte','user_manual', current_date + 30)`, [U]);
    const m = await one(db, `SELECT is_current, bool_or(has_conflict) OVER () AS any_conflict FROM profile_facts WHERE subject_type='self' AND attribute='coffee' AND value='Latte'`);
    assert.deepEqual(m, { is_current: false, any_conflict: false });
    assert.equal(await num(db, `SELECT count(*) FROM profile_facts WHERE subject_type='self' AND attribute='coffee' AND has_conflict`), 0);
    await db.query(`UPDATE fact_slots SET cardinality='many' WHERE user_id=$1 AND subject_type='self' AND attribute='city'`, [U]);
    assert.equal(await num(db, `SELECT count(*) FROM profile_facts WHERE attribute='city' AND subject_type='self' AND has_conflict`), 0);
  });
});

// ------------------------------------------------------------------ search
await test('match_claims: never private, hidden or another account', async () => {
  await db.query(`UPDATE claims SET embedding = array_fill(0.1::real, ARRAY[1536])::extensions.vector`);
  const vec = `[${Array(1536).fill(0.1).join(',')}]`;
  const ids = await as(db, HUMAN, async () => (await db.query(`SELECT id FROM match_claims($1::extensions.vector, -1, 500, $2)`, [vec, U])).rows.map((r) => r.id));
  for (const hidden of [b(14), b(15), b(9), c(13)]) assert.ok(!ids.includes(hidden), 'a hidden claim was returned');
  assert.ok(ids.includes(c(12)) && ids.includes(c(1)));
  await rejects(() => as(db, HUMAN, () => db.query(`SELECT id FROM match_claims($1::extensions.vector, -1, 5, $2)`, [vec, U2])), /not authorized/);
  await db.query(`UPDATE claims SET embedding = NULL`);
});

// ------------------------------------------------------------------ deletes
await test('deleting a contact deletes its claims, slots and suppressions (human and service role)', async () => {
  for (const who of [HUMAN, MACHINE]) {
    const left = await as(db, who, async () => {
      await db.query('DELETE FROM contacts WHERE id=$1', [D]);
      return one(db, `SELECT (SELECT count(*) FROM claims WHERE subject_id=$1) claims, (SELECT count(*) FROM fact_slots WHERE subject_id=$1) slots,
                             (SELECT count(*) FROM ai_suggestion_suppressions WHERE suppression_key LIKE 'contact:' || $1 || ':%') supp`, [D]);
    });
    assert.deepEqual(left, { claims: '0', slots: '0', supp: '0' });
  }
});
await test('deleting an account with a filled private section succeeds', async () => {
  await as(db, null, async () => {
    await db.query('DELETE FROM auth.users WHERE id=$1', [U2]);
    assert.equal(await num(db, 'SELECT count(*) FROM fact_slots WHERE user_id=$1', [U2]), 0);
  });
});
await test('a private section with facts cannot be deleted or renamed', async () => {
  await rejects(() => as(db, HUMAN, () => db.query(`DELETE FROM profile_categories WHERE id='ca000000-0000-0000-0000-000000000031'`)), /private_section_not_empty/);
  await rejects(() => as(db, HUMAN, () => db.query(`UPDATE profile_categories SET slug='wellness' WHERE id='ca000000-0000-0000-0000-000000000031'`)), /private_section_not_empty/);
  await as(db, HUMAN, () => db.query(`DELETE FROM profile_categories WHERE id='ca000000-0000-0000-0000-000000000032'`));
});

// ------------------------------------------------------------------ merges
await test('merge: shared value folds to the human copy, pins combine, private section and facts move', async () => {
  const r = await as(db, HUMAN, async () => {
    const supp = await num(db, 'SELECT count(*) FROM ai_suggestion_suppressions');
    await db.query(`SELECT merge_contacts_atomic(gen_random_uuid(), $1, $2, false)`, [M1, M2]);
    return one(db, `SELECT
      (SELECT string_agg(id::text, ',') FROM claims WHERE subject_id=$2 AND attribute='color' AND valid_to IS NULL) color_ids,
      (SELECT subject_id FROM claims WHERE id=$3) migraine_subject,
      (SELECT is_pinned FROM fact_slots WHERE subject_id=$2 AND attribute='color') pinned,
      (SELECT visibility_scope FROM profile_categories WHERE contact_id=$2 AND slug='health') health,
      (SELECT count(*) FROM claims WHERE subject_id=$1) + (SELECT count(*) FROM fact_slots WHERE subject_id=$1) leftovers,
      (SELECT count(*) FROM ai_suggestion_suppressions) - $4 new_suppressions`, [M1, M2, b(20), supp]);
  });
  assert.deepEqual(r, { color_ids: c(17), migraine_subject: M2, pinned: true, health: 'private', leftovers: '0', new_suppressions: '0' });
});
await test('merge into self: claims move to self, identical values fold to the preferred copy', async () => {
  const r = await as(db, HUMAN, async () => {
    await db.query(`SELECT merge_contacts_atomic(gen_random_uuid(), $1, NULL, true)`, [SC]);
    return one(db, `SELECT
      (SELECT string_agg(id::text, ',') FROM claims WHERE user_id=$1 AND subject_type='self' AND attribute='employer' AND valid_to IS NULL) employer,
      (SELECT count(*) FROM claims WHERE subject_id=$2) leftovers,
      (SELECT count(*) FROM claims WHERE subject_type='self' AND attribute='also-known-as') aka`, [U, SC]);
  });
  assert.deepEqual(r, { employer: b(4), leftovers: '0', aka: '1' });
});

await test('reconcile fold: a self-duplicate contact\'s facts move to self, the human copy kept', async () => {
  const r = await as(db, MACHINE, async () => {
    const outcome = await val(db, 'SELECT fold_contact_into_self($1, $2)', [U, SC]);
    return { outcome, ...(await one(db, `SELECT
      (SELECT string_agg(id::text, ',') FROM claims WHERE user_id=$1 AND subject_type='self' AND attribute='employer' AND valid_to IS NULL) employer,
      (SELECT count(*) FROM claims WHERE subject_id=$2) + (SELECT count(*) FROM fact_slots WHERE subject_id=$2) leftovers`, [U, SC])) };
  });
  assert.deepEqual(r, { outcome: 'folded', employer: b(4), leftovers: '0' });
});
await test('reconcile fold: two human copies of one value → the contact is skipped, nothing moves', async () => {
  const r = await as(db, MACHINE, async () => {
    await db.query(`RESET ROLE`);
    await db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin) VALUES ($1,'self','pet','Rex','user_manual')`, [U]);
    await db.query(`SET LOCAL ROLE service_role`);
    const outcome = await val(db, 'SELECT fold_contact_into_self($1, $2)', [U, A]);
    return { outcome, left: await num(db, 'SELECT count(*) FROM claims WHERE subject_id=$1', [A]) > 0 };
  });
  assert.deepEqual(r, { outcome: 'skipped_two_preferred', left: true });
});

// ------------------------------------------------------------------ rollback
await test('rollback restores the snapshot, keeps a post-switch fact aside, and the old triggers work', async () => {
  await as(db, HUMAN, () => db.query(`INSERT INTO claims (user_id, subject_type, attribute, value, origin) VALUES ($1,'self','hobby','Running','user_manual')`, [U]), { keep: true });
  const kept = await applyTx(db, SQL.rollback, () => val(db, 'SELECT count(*) FROM fact_backup.dropped_by_rollback'));
  assert.equal(Number(kept), 1);
  for (const t of ['profile_entries', 'profile_categories', 'claims', 'ai_suggestion_suppressions', 'review_queue']) {
    const cols = (await db.query(`SELECT string_agg(quote_ident(column_name), ',') s FROM information_schema.columns
      WHERE table_schema='fact_backup' AND table_name=$1 AND column_name <> 'embedding'`, [t])).rows[0].s;
    const diff = await num(db, `SELECT count(*) FROM ((SELECT ${cols} FROM public.${t} EXCEPT ALL SELECT ${cols} FROM fact_backup.${t})
                                UNION ALL (SELECT ${cols} FROM fact_backup.${t} EXCEPT ALL SELECT ${cols} FROM public.${t})) x`);
    assert.equal(diff, 0, `${t} differs from the snapshot`);
  }
  assert.equal(await num(db, `SELECT count(*) FROM pg_trigger WHERE tgrelid='public.profile_entries'::regclass AND NOT tgisinternal AND tgenabled='O'`), 12);
  assert.equal(await val(db, `SELECT to_regnamespace('fact_retired')`), null);
  assert.equal(await val(db, `SELECT to_regclass('public.fact_slots')`), null);
  // The functions and view are the live ones again, byte for byte.
  const tpl = new pg.Client({ host, port, user: 'postgres', database: 'live_tpl' });
  await tpl.connect();
  const defs = `SELECT k, v FROM (
      SELECT p.oid::regprocedure::text k, md5(pg_get_functiondef(p.oid)) v FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
      UNION ALL SELECT 'view world_claims', md5(pg_get_viewdef('public.world_claims'::regclass))
      UNION ALL SELECT 'trigger ' || tgrelid::regclass::text || '.' || tgname, md5(pg_get_triggerdef(t.oid)) || tgenabled::text FROM pg_trigger t WHERE NOT tgisinternal
        AND tgrelid IN ('public.profile_entries'::regclass, 'public.claims'::regclass, 'public.contacts'::regclass, 'public.entities'::regclass, 'public.profile_categories'::regclass)
      UNION ALL SELECT 'acl ' || relname, (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a)
        FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('profile_entries','claims','world_claims','profile_categories')
      UNION ALL SELECT 'acl ' || p.oid::regprocedure::text, (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a)
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('match_claims','merge_contacts_atomic','contact_merge_move_references','user_today')) y`;
  const asMap = async (client) => { await client.query("SET search_path TO DEFAULT"); return new Map((await client.query(defs)).rows.map((r) => [r.k, r.v])); };
  const [now, then] = [await asMap(db), await asMap(tpl)];
  await tpl.end();
  const differing = [...new Set([...now.keys(), ...then.keys()])].filter((k) => now.get(k) !== then.get(k));
  assert.deepEqual(differing, [], 'these differ from the live schema');
  // The old triggers work again: a machine edit of a human entry is put back
  // (world_preferred_wins), and a normal entry's edit reaches its claim (sync_claim).
  // Rolled back: the old canonicalize trigger rewrites neighbouring rows too.
  await as(db, null, async () => {
    await db.query(`UPDATE profile_entries SET value='Deutsch' WHERE id=$1`, [b(1)]);
    assert.equal(await val(db, 'SELECT value FROM profile_entries WHERE id=$1', [b(1)]), 'German');
    await db.query(`UPDATE profile_entries SET value='Potsdam' WHERE id=$1`, [b(2)]);
    assert.equal(await val(db, 'SELECT value FROM claims WHERE id=$1', [c(2)]), 'Potsdam');
  });
});
await test('after the rollback, schema and switch apply again with the same counts', async () => {
  await buildLabelMap(db);
  await applyTx(db, SQL.schema);
  const again = await runSwitch(db);
  assert.deepEqual(again, report);
});
await db.end();

// ------------------------------------------------------------------ pre-checks and assertions
await test('pre-check: a leftover slot stops the switch', async () => {
  const x = await prepared('fs_precheck_slot');
  await applyTx(x, SQL.schema);
  await x.query(`INSERT INTO fact_slots (user_id, subject_type, attribute, label) VALUES ($1,'self','x','X')`, [U]);
  await rejects(() => runSwitch(x), /fact_slots is not empty/);
  assert.equal(await val(x, `SELECT to_regclass('public.profile_entries')`), 'profile_entries');
  await x.end();
});
await test('pre-check: a missing label stops the switch', async () => {
  const x = await prepared('fs_precheck_label');
  await applyTx(x, SQL.schema);
  await x.query(`DELETE FROM fact_label_map WHERE kind='label' AND key='Pet'`);
  await rejects(() => runSwitch(x), /entry labels are missing/);
  await x.end();
});
await test('assertion: a private entry that would become public stops the switch', async () => {
  const x = await prepared('fs_assert_private');
  // Corrupt: Alex's entry filed in a private section that belongs to self.
  await x.query(`INSERT INTO profile_categories (id, user_id, contact_id, name, slug, visibility_scope) VALUES ('ca000000-0000-0000-0000-0000000000ff',$1,NULL,'Vault','vault','private')`, [U]);
  await x.query(`ALTER TABLE profile_entries DISABLE TRIGGER USER`);
  await x.query(`INSERT INTO profile_entries (user_id, contact_id, category_id, label, value, origin) VALUES ($1,$2,'ca000000-0000-0000-0000-0000000000ff','Secret','Kept quiet','user_manual')`, [U, A]);
  await x.query(`ALTER TABLE profile_entries ENABLE TRIGGER USER`);
  await buildLabelMap(x);
  await applyTx(x, SQL.schema);
  await rejects(() => runSwitch(x), /private-section entries are not private/);
  await x.end();
});

await admin.end();
const failed = results.filter((r) => r[1] !== 'ok');
for (const r of results) console.log(`${r[1] === 'ok' ? 'ok  ' : 'FAIL'}  ${r[0]}${r[2] ? `\n      ${r[2]}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log('switch report:', JSON.stringify(report));
process.exit(failed.length ? 1 : 0);
