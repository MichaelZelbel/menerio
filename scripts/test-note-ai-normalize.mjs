/**
 * A ticked checkbox must not be a new revision.
 *
 * On 2026-09-10 one checklist note bought the whole analysis pipeline 17 times
 * because "- [ ]" turning into "- [x]" changed the raw-body hash. The queue's
 * fingerprint now hashes public.note_ai_normalize_text(content); this test runs
 * that SQL function, extracted from its migration, against a disposable local
 * database and pins the four cases its TypeScript twin
 * (_shared/note-ai-policy.ts, normalizeNoteText) is tested on, so the two
 * cannot drift apart without one of the tests noticing.
 */
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

const url = process.env.NOTE_AI_NORMALIZE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/note_ai_normalize_test') {
    throw Error('Local note_ai_normalize_test required');
  }
}
const db = new Client(url ? { connectionString: url } : { host: '/var/run/postgresql', database: 'note_ai_normalize_test', user: 'postgres' });
await db.connect();
try {
  const migration = await readFile(new URL('../supabase/migrations/20260911003000_note_ai_cosmetic_edits_and_spacing.sql', import.meta.url), 'utf8');
  const fn = migration.match(/create or replace function public\.note_ai_normalize_text[\s\S]*?\$\$;\n/);
  assert.ok(fn, 'note_ai_normalize_text definition not found in the migration');
  await db.query(fn[0]);

  const norm = async (text) => (await db.query('select public.note_ai_normalize_text($1) as n', [text])).rows[0].n;

  const unchecked = '- [ ] call the bank\n- [ ] write\n\n* [ ] nested\n1. [ ] numbered';
  const checked = '- [x] call the bank\n- [X] write\n\n* [x] nested\n1. [x] numbered';
  assert.equal(await norm(checked), await norm(unchecked), 'ticking a checkbox must not change the text the fingerprint sees');

  const clean = 'first line\nsecond line\n\nthird';
  assert.equal(await norm('first line   \r\nsecond line\r\n\r\n\r\n\r\nthird\n\n'), clean, 'line endings, trailing spaces and blank-line runs are not content');
  assert.equal(await norm('\n\nfirst line\nsecond line\n\nthird'), clean);
  assert.equal(await norm('first line\t\nsecond line\n\nthird'), clean);

  assert.notEqual(await norm('- [ ] call the bank\nDone at noon.'), await norm('- [x] call the bank'), 'a real sentence is a real change');
  assert.notEqual(await norm('plan a'), await norm('plan b'));

  assert.equal(await norm(null), '');
  assert.equal(await norm('  '), '');
  assert.equal(await norm(await norm(checked)), await norm(checked), 'normalizing twice is the same as once');

  console.log('note_ai_normalize_text: checkbox ticks, line endings and blank lines are invisible; sentences are not');
} finally {
  await db.end();
}
