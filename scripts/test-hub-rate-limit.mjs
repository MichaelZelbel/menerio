/**
 * The Hub API throttle must hold when requests arrive together, not only when
 * they arrive one at a time.
 *
 * The check it replaced read the counter, decided, then wrote an absolute value
 * back. Sequentially that looks correct, which is why it survived review. In
 * parallel every caller reads the same count and writes the same count + 1, so
 * a burst of N advances the counter by one and all N are admitted. This test
 * runs both versions against real concurrent connections and asserts the
 * difference, so the atomic version cannot quietly be reverted to the readable
 * one.
 */
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

// A fresh disposable local database only; no application credentials are read.
const url = process.env.HUB_RATE_LIMIT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/hub_rate_limit_test') {
    throw Error('Local hub_rate_limit_test required');
  }
}

const clients = [];
async function connect() {
  const c = new Client(url ? { connectionString: url } : { host: '/var/run/postgresql', database: 'hub_rate_limit_test', user: 'postgres' });
  await c.connect();
  clients.push(c);
  return c;
}

const LIMIT = 5;
const BURST = 40;
const WINDOW = '2026-09-09T12:00:00.000Z';

try {
  const db = await connect();
  const migration = await readFile(new URL('../supabase/migrations/20260909120000_atomic_hub_api_rate_limit.sql', import.meta.url), 'utf8');
  await db.query(migration);

  const { rows: [key] } = await db.query(
    'insert into hub_api_keys(user_id) values (gen_random_uuid()) returning id'
  );

  // Each concurrent request needs its own connection; one client serialises them.
  const pool = [];
  for (let i = 0; i < BURST; i++) pool.push(await connect());

  const burst = async (fn, windowStart) => {
    await db.query('delete from hub_api_usage');
    const results = await Promise.all(
      pool.map((c) => c.query(`select allowed, request_count from ${fn}($1, $2, $3)`, [key.id, windowStart, LIMIT]))
    );
    const allowed = results.filter((r) => r.rows[0].allowed).length;
    const { rows: [stored] } = await db.query(
      'select request_count from hub_api_usage where key_id = $1 and window_start = $2', [key.id, windowStart]
    );
    return { allowed, stored: stored?.request_count ?? 0 };
  };

  // 1. The old check, proving the failure is real and not theoretical.
  const legacy = await burst('legacy_bump_usage', WINDOW);
  console.log(`legacy read-then-write : limit=${LIMIT} burst=${BURST} allowed=${legacy.allowed} stored=${legacy.stored}`);
  assert.ok(
    legacy.allowed > LIMIT,
    'fixture no longer reproduces the race, so it can no longer prove the fix'
  );

  // 2. The atomic version admits exactly the limit, whatever the concurrency.
  const atomic = await burst('hub_api_bump_usage', WINDOW);
  console.log(`atomic increment       : limit=${LIMIT} burst=${BURST} allowed=${atomic.allowed} stored=${atomic.stored}`);
  assert.equal(atomic.allowed, LIMIT, `a parallel burst got ${atomic.allowed} requests past a limit of ${LIMIT}`);
  assert.equal(atomic.stored, BURST, 'every request must be counted, including the refused ones');

  // 3. Sequential behaviour is unchanged: the Nth request inside the limit passes.
  await db.query('delete from hub_api_usage');
  for (let i = 1; i <= LIMIT + 2; i++) {
    const { rows: [r] } = await db.query('select allowed, request_count from hub_api_bump_usage($1,$2,$3)', [key.id, WINDOW, LIMIT]);
    assert.equal(r.request_count, i, 'counter must advance by exactly one per call');
    assert.equal(r.allowed, i <= LIMIT, `request ${i} of a ${LIMIT} limit decided wrongly`);
  }

  // 4. A new window is a clean slate, and windows do not bleed into each other.
  const next = '2026-09-09T13:00:00.000Z';
  const { rows: [fresh] } = await db.query('select allowed, request_count from hub_api_bump_usage($1,$2,$3)', [key.id, next, LIMIT]);
  assert.equal(fresh.request_count, 1, 'a new window starts at one');
  assert.equal(fresh.allowed, true);
  const { rows: [old] } = await db.query('select request_count from hub_api_usage where key_id=$1 and window_start=$2', [key.id, WINDOW]);
  assert.equal(old.request_count, LIMIT + 2, 'the previous window must be untouched');

  // 5. Two keys are throttled independently.
  const { rows: [other] } = await db.query('insert into hub_api_keys(user_id) values (gen_random_uuid()) returning id');
  const { rows: [independent] } = await db.query('select allowed, request_count from hub_api_bump_usage($1,$2,$3)', [other.id, WINDOW, LIMIT]);
  assert.equal(independent.request_count, 1, 'one key\'s traffic must not throttle another');
  assert.equal(independent.allowed, true);

  // 6. A nonsense limit is refused rather than silently admitting everything.
  for (const bad of [0, -1, null]) {
    await assert.rejects(
      () => db.query('select * from hub_api_bump_usage($1,$2,$3)', [key.id, WINDOW, bad]),
      /positive integer/,
      `limit ${bad} must be refused`
    );
  }

  // 7. Only the service role may call it. anon or authenticated must not be able
  //    to inflate, or read, another key's counter.
  for (const role of ['anon', 'authenticated']) {
    const c = await connect();
    await c.query(`set role ${role}`);
    await assert.rejects(
      () => c.query('select * from hub_api_bump_usage($1,$2,$3)', [key.id, WINDOW, LIMIT]),
      /permission denied/i,
      `${role} must not be able to execute hub_api_bump_usage`
    );
  }

  console.log('hub rate limit: atomic under concurrency, correct sequentially, service-role only');
} finally {
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
}
