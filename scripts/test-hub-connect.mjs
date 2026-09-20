/**
 * The "connect your hub" flow against a real Postgres: the migration itself is
 * applied, the hub_connect_* functions are called the way the edge function
 * calls them, and the real lookupHubKey (bundled from _shared/hub-auth.ts) is
 * pointed at the same database to prove the one rule the whole flow exists for:
 * a key of an older generation, or of an ended connection, stops working, and a
 * key that belongs to no connection never notices any of it.
 *
 * The limits have to hold when requests arrive together, not only one at a
 * time, so the guessing tests run as parallel bursts on separate connections.
 * The last part serves the real hub-connect/index.ts in this process, against
 * the same database, and checks the HTTP answers the contract lists.
 *
 *   createdb hub_connect_test
 *   psql -v ON_ERROR_STOP=1 -d hub_connect_test -f scripts/bootstrap-hub-connect-test.sql
 *   node scripts/test-hub-connect.mjs
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import pg from 'pg';

const { Client } = pg;

// A fresh disposable local database only; no application credentials are read.
const url = process.env.HUB_CONNECT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/hub_connect_test') {
    throw Error('Local hub_connect_test required');
  }
}

const clients = [];
async function connect(role) {
  const c = new Client(url ? { connectionString: url } : { host: '/var/run/postgresql', database: 'hub_connect_test', user: 'postgres' });
  await c.connect();
  clients.push(c);
  if (role) await c.query(`set role ${role}`);
  return c;
}

/** Bundle a pure edge-function module so Node can import it; the supabase import is never reached. */
async function load(entry) {
  const bundle = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{
      name: 'no-remote-client', setup(b) {
        b.onResolve({ filter: /^https:/ }, (args) => ({ path: args.path, namespace: 'fake' }));
        b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({
          contents: "export const createClient = () => { throw new Error('the test hands the client in') }", loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

/**
 * Just enough of supabase-js for lookupHubKey, backed by the real database:
 * .from(t).select(cols).eq(..).maybeSingle() and .from(t).update(v).eq(..).
 * Errors come back as { error: { code, message } }, the way PostgREST reports them.
 */
function supabaseLike(db) {
  return {
    from(table) {
      let columns = '*';
      let patch = null;
      const where = [];
      const values = [];
      const q = {
        select(c) { columns = c; return q; },
        update(v) { patch = v; return q; },
        eq(k, v) { values.push(v); where.push(`"${k}" = $${values.length}`); return q; },
        maybeSingle() { return q; },
        then(ok, fail) {
          const run = async () => {
            try {
              if (patch) {
                const sets = Object.entries(patch).map(([k, v]) => { values.push(v); return `"${k}" = $${values.length}`; });
                await db.query(`update ${table} set ${sets.join(', ')} where ${where.join(' and ')}`, values);
                return { data: null, error: null };
              }
              const { rows } = await db.query(`select ${columns} from ${table} where ${where.join(' and ')}`, values);
              return { data: rows[0] ?? null, error: null };
            } catch (err) {
              return { data: null, error: { code: err.code, message: err.message } };
            }
          };
          return run().then(ok, fail);
        },
      };
      return q;
    },
  };
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');
const newVerifier = () => randomBytes(32).toString('base64url');
const newKey = () => { const fullKey = `mnr_${randomBytes(24).toString('hex')}`; return { fullKey, hash: sha256(fullKey), prefix: fullKey.slice(0, 12) }; };

/**
 * The real edge function, bundled and served in this process. Only the client
 * is synthetic: rpc() and from() run against the test database, a session token
 * is "session:<user id>", and everything the function logs is kept so the test
 * can prove no secret is in it.
 */
async function serveFunction(entry, db, authDb, logged) {
  const bundle = await build({
    entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{
      name: 'synthetic-database', setup(b) {
        b.onResolve({ filter: /^https:/ }, (args) => ({ path: args.path, namespace: 'fake' }));
        b.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: 'export const createClient = (_u, _k, options) => globalThis.makeClient(options)', loader: 'js' }));
      },
    }],
  });
  // Supabase Auth answers these, not the service role's table grants.
  const userById = async (id) => (await authDb.query('select id, email from auth.users where id=$1', [id])).rows[0] ?? null;
  const makeClient = (options) => ({
    ...supabaseLike(db),
    async rpc(name, args) {
      // The Hub API throttle has its own test; here it lets everything through.
      if (name === 'hub_api_bump_usage') return { data: [{ allowed: true }], error: null };
      const names = Object.keys(args);
      try {
        const { rows } = await db.query(`select public.${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`, names.map((n) => args[n]));
        return { data: rows[0].r, error: null };
      } catch (err) {
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
    auth: {
      async getUser() {
        const match = /^Bearer session:(.+)$/.exec(options?.global?.headers?.Authorization ?? '');
        const user = match ? await userById(match[1]) : null;
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid session' } };
      },
      admin: { getUserById: async (id) => ({ data: { user: await userById(id) }, error: null }) },
    },
  });
  let handler;
  const keep = (...args) => logged.push(args.map(String).join(' '));
  vm.runInNewContext(bundle.outputFiles[0].text, {
    makeClient, console: { log: keep, warn: keep, error: keep },
    Request, Response, URL, Headers, TextEncoder, crypto: webcrypto, setTimeout, clearTimeout,
    Deno: {
      env: { get: (key) => ({ SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' })[key] },
      serve: (fn) => { handler = fn; },
    },
  });
  return handler;
}

const run = randomUUID().slice(0, 8);
const callerHash = (name) => `test:${run}:${name}`;
// Requests opened through the HTTP section carry a real (hashed) caller, so they are removed by id.
const httpRequests = [];
let db;

try {
  db = await connect();
  await db.query(await readFile(new URL('../supabase/migrations/20260920120000_hub_connections.sql', import.meta.url), 'utf8'));
  // Applying it twice has to be harmless: Lovable and the CLI may both try.
  await db.query(await readFile(new URL('../supabase/migrations/20260920120000_hub_connections.sql', import.meta.url), 'utf8'));

  const protocol = await load('supabase/functions/_shared/hub-connect-protocol.ts');
  const { lookupHubKey } = await load('supabase/functions/_shared/hub-auth.ts');
  const LIMITS = protocol.HUB_CONNECT_LIMITS;
  const SCOPES = [...protocol.HUB_GRANT_SCOPES];

  // Everything below runs the way the edge function does: as the service role.
  const svc = await connect('service_role');
  const admin = supabaseLike(svc);

  const { rows: [{ id: userA }] } = await db.query("insert into auth.users(email) values ($1) returning id", [`a-${run}@example.test`]);
  const { rows: [{ id: userB }] } = await db.query("insert into auth.users(email) values ($1) returning id", [`b-${run}@example.test`]);

  // A key made by hand, before any of this. It must come out of the whole run unchanged.
  const legacy = newKey();
  await db.query(
    "insert into hub_api_keys(user_id, key_hash, key_prefix, name, scopes) values ($1,$2,$3,'Made by hand',$4)",
    [userA, legacy.hash, legacy.prefix, ['notes', 'profile']],
  );
  const legacySnapshot = async () => (await db.query(
    "select id, user_id, key_hash, key_prefix, name, scopes, expires_at, is_active, created_at, hub_connection_id, generation from hub_api_keys where key_hash = $1", [legacy.hash],
  )).rows[0];
  const legacyBefore = await legacySnapshot();
  assert.equal(legacyBefore.hub_connection_id, null);
  assert.equal(legacyBefore.generation, null);

  const hubId = randomUUID();
  const deviceId = randomUUID();

  // A caller of its own per request unless the hourly limit is what is being tested.
  const start = async (on, { caller = randomUUID(), hub = hubId, max = LIMITS.startsPerHour } = {}) => {
    const verifier = newVerifier();
    const { rows: [{ r }] } = await on.query(
      'select hub_connect_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r',
      [hub, 'Test hub', deviceId, 'Test laptop', 'browser', { context: true, documents: false },
        challengeOf(verifier), protocol.generateUserCode((n) => randomBytes(n)), callerHash(caller), LIMITS.requestTtlSeconds, max],
    );
    return { ...r, verifier };
  };
  const view = async (requestId, userId) =>
    (await svc.query('select hub_connect_view($1,$2) as r', [requestId, userId])).rows[0].r;
  const decide = async (on, requestId, userId, code, approve = true) =>
    (await on.query('select hub_connect_decide($1,$2,$3,$4,$5,$6) as r', [requestId, userId, code, approve, false, LIMITS.maxWrongCodes])).rows[0].r;
  // gapMs 0 unless the poll gap itself is under test, so the run does not sleep.
  const collect = async (on, requestId, verifier, { key = newKey(), gapMs = 0 } = {}) => {
    const { rows: [{ r }] } = await on.query(
      'select hub_connect_collect($1,$2,$3,$4,$5,$6,$7,$8) as r',
      [requestId, challengeOf(verifier), deviceId, key.hash, key.prefix, SCOPES, gapMs, LIMITS.maxWrongVerifiers],
    );
    return { ...r, key };
  };
  const statusOf = async (requestId) =>
    (await db.query('select status, wrong_codes, wrong_verifiers, user_id from hub_connect_requests where id=$1', [requestId])).rows[0];

  // Each concurrent caller needs its own connection; one client serialises them.
  const pool = [];
  for (let i = 0; i < 20; i++) pool.push(await connect('service_role'));

  // 1. /start: ten an hour per caller address, also when they arrive together.
  {
    const burst = await Promise.all(pool.map((c) => start(c, { caller: 'burst' })));
    assert.equal(burst.filter((r) => r.allowed).length, LIMITS.startsPerHour, 'a parallel burst got past the starts-per-hour limit');
    assert.equal((await start(svc, { caller: 'burst' })).allowed, false, 'the eleventh start of the hour must be refused');
    assert.equal((await start(svc, { caller: 'someone-else' })).allowed, true, "one caller's starts must not throttle another");
    console.log(`start                 : ${LIMITS.startsPerHour} of ${pool.length} parallel starts admitted, next one refused`);
  }

  // 2. The first account to open a request owns it. A second account sees nothing and can answer nothing.
  const first = await start(svc);
  {
    assert.equal(first.allowed, true);
    assert.equal((await collect(svc, first.request_id, first.verifier)).status, 'pending', 'an unanswered request must say pending');
    const seen = await view(first.request_id, userA);
    assert.equal(seen.hub_name, 'Test hub');
    assert.equal(seen.device_name, 'Test laptop');
    assert.equal(seen.user_code, first.user_code);
    assert.equal(seen.reconnect, false);
    for (const secret of ['code_challenge', 'caller_hash', 'wrong_codes']) assert.ok(!(secret in seen), `${secret} must not reach the page`);

    assert.equal(await view(first.request_id, userB), null, 'user B must not be able to read user A\'s request');
    assert.equal((await decide(svc, first.request_id, userB, first.user_code)).outcome, 'not_found', 'user B must not be able to approve user A\'s request');
    assert.equal((await statusOf(first.request_id)).status, 'pending', 'a refused answer must change nothing');
    assert.equal(await view(randomUUID(), userA), null, 'an unknown request is not found');
    console.log('ownership             : user B can neither read nor approve the request user A opened');
  }

  // 3. The poll gap: a second poll inside it is told to slow down, and is not counted as anything else.
  {
    const soon = await collect(svc, first.request_id, first.verifier, { gapMs: 60_000 });
    assert.equal(soon.outcome, 'slow_down');
    assert.equal((await statusOf(first.request_id)).wrong_verifiers, 0);
  }

  // 4. Approve creates the connection; the key can be collected exactly once.
  let firstKey;
  {
    const approved = await decide(svc, first.request_id, userA, first.user_code);
    assert.equal(approved.outcome, 'approved');
    assert.equal(approved.generation, 1);
    const { rows: [connection] } = await db.query('select * from hub_connections where id=$1', [approved.connection_id]);
    assert.equal(connection.user_id, userA);
    assert.equal(connection.hub_id, hubId);
    assert.equal(connection.status, 'active');
    assert.equal(await view(first.request_id, userA), null, 'an answered request is no longer shown');

    // Ten hubs' worth of correct polls at once: one key, not ten.
    const race = await Promise.all(pool.slice(0, 10).map((c) => collect(c, first.request_id, first.verifier)));
    const winners = race.filter((r) => r.outcome === 'collected');
    assert.equal(winners.length, 1, `the key was handed over ${winners.length} times`);
    firstKey = winners[0].key;
    assert.equal(winners[0].generation, 1);
    assert.equal(winners[0].connection_id, approved.connection_id);
    assert.equal(winners[0].user_id, userA);
    const { rows: stored } = await db.query('select key_hash, generation, scopes, is_active from hub_api_keys where hub_connection_id=$1', [approved.connection_id]);
    assert.equal(stored.length, 1, 'exactly one key row per collection');
    assert.equal(stored[0].key_hash, firstKey.hash);
    assert.deepEqual(stored[0].scopes, SCOPES);
    assert.ok(!JSON.stringify(stored).includes(firstKey.fullKey), 'only the hash is stored');

    const again = await collect(svc, first.request_id, first.verifier);
    assert.equal(again.outcome, 'not_collectable');
    assert.equal(again.status, 'collected');
    assert.equal(protocol.tokenErrorForStatus(again.status), 'expired_token', 'a second collection answers expired_token');

    const accepted = await lookupHubKey(firstKey.fullKey, admin);
    assert.equal(accepted.result?.userId, userA);
    assert.equal(accepted.result?.connectionId, approved.connection_id);
    console.log('approve and collect   : connection created, key handed over once in a race of ten, second collection expired');
  }

  // 5. Wrong verifiers count, and the fifth ends the request for the right one too.
  {
    const r = await start(svc, { hub: randomUUID() });
    await decide(svc, r.request_id, userA, r.user_code);
    for (let i = 1; i <= LIMITS.maxWrongVerifiers; i++) {
      assert.equal((await collect(svc, r.request_id, newVerifier())).outcome, 'invalid_grant');
      const row = await statusOf(r.request_id);
      assert.equal(row.wrong_verifiers, i);
      assert.equal(row.status, i < LIMITS.maxWrongVerifiers ? 'approved' : 'expired', `wrong verifier ${i} decided wrongly`);
    }
    const late = await collect(svc, r.request_id, r.verifier);
    assert.equal(late.outcome, 'not_collectable');
    assert.equal(protocol.tokenErrorForStatus(late.status), 'expired_token');

    // The same limit under a parallel burst of guesses.
    const b = await start(svc, { hub: randomUUID() });
    await decide(svc, b.request_id, userA, b.user_code);
    const guesses = await Promise.all(pool.map((c) => collect(c, b.request_id, newVerifier())));
    assert.equal(guesses.filter((g) => g.outcome === 'collected').length, 0);
    assert.equal(guesses.filter((g) => g.outcome === 'invalid_grant').length, LIMITS.maxWrongVerifiers, 'a burst got more guesses than the limit');
    assert.equal((await collect(svc, b.request_id, b.verifier)).outcome, 'not_collectable');
    console.log(`wrong verifiers       : request dead after ${LIMITS.maxWrongVerifiers}, one at a time and in a burst of ${pool.length}`);
  }

  // 6. Wrong comparison codes count, and the fifth denies the request.
  {
    const deniedHub = randomUUID();
    const r = await start(svc, { hub: deniedHub });
    const wrong = r.user_code === 'BBBB-BBBB' ? 'CCCC-CCCC' : 'BBBB-BBBB';
    for (let i = 1; i < LIMITS.maxWrongCodes; i++) {
      const answer = await decide(svc, r.request_id, userA, wrong);
      assert.equal(answer.outcome, 'wrong_code');
      assert.equal(answer.attempts_left, LIMITS.maxWrongCodes - i);
    }
    // A code that could not be a code arrives as NULL and counts like any other.
    assert.equal((await decide(svc, r.request_id, userA, null)).outcome, 'denied');
    assert.equal((await statusOf(r.request_id)).status, 'denied');
    assert.equal((await decide(svc, r.request_id, userA, r.user_code)).outcome, 'not_found', 'the right code comes too late');
    const polled = await collect(svc, r.request_id, r.verifier);
    assert.equal(protocol.tokenErrorForStatus(polled.status), 'access_denied');
    assert.equal((await db.query('select count(*)::int as n from hub_connections where hub_id=$1', [deniedHub])).rows[0].n, 0, 'a denied request must not leave a connection behind');

    const b = await start(svc, { hub: randomUUID() });
    const burst = await Promise.all(pool.map((c) => decide(c, b.request_id, userA, wrong)));
    assert.equal(burst.filter((g) => g.outcome === 'wrong_code').length, LIMITS.maxWrongCodes - 1);
    assert.equal(burst.filter((g) => g.outcome === 'denied').length, 1);
    assert.equal(burst.filter((g) => g.outcome === 'not_found').length, pool.length - LIMITS.maxWrongCodes);

    // Saying no also needs the code, and ends the request.
    const n = await start(svc, { hub: randomUUID() });
    assert.equal((await decide(svc, n.request_id, userA, n.user_code, false)).outcome, 'denied');
    assert.equal(protocol.tokenErrorForStatus((await collect(svc, n.request_id, n.verifier)).status), 'access_denied');
    console.log(`wrong codes           : request denied after ${LIMITS.maxWrongCodes}, one at a time and in a burst of ${pool.length}`);
  }

  // 7. Connecting the same hub again raises the generation and the OLD key stops authenticating.
  let secondKey;
  let connectionId;
  {
    const stale = await start(svc); // approved now, collected never: must die with its generation
    const r = await start(svc);
    assert.equal((await view(r.request_id, userA)).reconnect, true, 'the page must say this hub is already connected');
    assert.equal((await decide(svc, stale.request_id, userA, stale.user_code)).generation, 2);
    const approved = await decide(svc, r.request_id, userA, r.user_code);
    assert.equal(approved.generation, 3);
    connectionId = approved.connection_id;
    assert.equal((await db.query('select count(*)::int as n from hub_connections where user_id=$1 and hub_id=$2', [userA, hubId])).rows[0].n, 1, 'one connection per account and hub');

    assert.equal((await db.query('select is_active from hub_api_keys where key_hash=$1', [firstKey.hash])).rows[0].is_active, false, 'the older key must be switched off');
    let refused = await lookupHubKey(firstKey.fullKey, admin);
    assert.equal(refused.result, null);
    assert.equal(refused.errorMessage, "This hub's connection to Menerio was ended.");
    // Even switched back on by hand, the generation alone keeps it out.
    await db.query('update hub_api_keys set is_active = true where key_hash=$1', [firstKey.hash]);
    refused = await lookupHubKey(firstKey.fullKey, admin);
    assert.equal(refused.result, null, 'an old-generation key must not authenticate even when active');
    assert.equal(refused.errorCode, 'connection_ended');
    assert.equal((await svc.query('select hub_connect_disconnect(null,null,(select id from hub_api_keys where key_hash=$1)) as r', [firstKey.hash])).rows[0].r, 'revoked', 'an old key must not be able to end the connection that replaced it');

    const dead = await collect(svc, stale.request_id, stale.verifier);
    assert.equal(dead.outcome, 'not_collectable', 'an approval of an older generation must not yield a key');
    assert.equal(dead.status, 'expired');

    const collected = await collect(svc, r.request_id, r.verifier);
    assert.equal(collected.outcome, 'collected');
    assert.equal(collected.generation, 3);
    secondKey = collected.key;
    assert.equal((await lookupHubKey(secondKey.fullKey, admin)).result?.connectionId, connectionId);
    console.log('reconnect             : generation raised, old key refused (also when re-activated), new key accepted');
  }

  // 8. /status: contact is recorded per device and assistant; a hand-made key has no connection to report.
  {
    const keyId = (await db.query('select id from hub_api_keys where key_hash=$1', [secondKey.hash])).rows[0].id;
    const other = randomUUID();
    await svc.query('select hub_connect_touch($1,$2,$3,$4,$5)', [keyId, deviceId, 'Test laptop', 'claude-code', 'configured']);
    await svc.query('select hub_connect_touch($1,$2,$3,$4,$5)', [keyId, deviceId, null, 'codex', 'waiting']);
    const { rows: [{ r }] } = await svc.query('select hub_connect_touch($1,$2,$3,$4,$5) as r', [keyId, other, 'VPS', 'claude-code', 'working']);
    assert.equal(r.connection_id, connectionId);
    assert.equal(r.generation, 3);
    assert.equal(r.devices.length, 2);
    const laptop = r.devices.find((d) => d.device_id === deviceId);
    assert.equal(laptop.name, 'Test laptop', 'a contact without a name must keep the known one');
    assert.deepEqual(Object.keys(laptop.clients).sort(), ['claude-code', 'codex']);
    assert.equal(laptop.clients.codex.state, 'waiting');
    assert.equal(r.devices.find((d) => d.device_id === other).clients['claude-code'].state, 'working');

    const legacyId = (await db.query('select id from hub_api_keys where key_hash=$1', [legacy.hash])).rows[0].id;
    assert.equal((await svc.query('select hub_connect_touch($1,$2,$3,$4,$5) as r', [legacyId, deviceId, 'x', 'codex', 'working'])).rows[0].r, null);
    console.log('status                : two devices, three assistant states recorded; hand-made key reports no connection');
  }

  // 9. Row-level security: the owner reads, nobody else does, and nobody writes or calls the functions.
  {
    const asUser = async (userId) => {
      const c = await connect('authenticated');
      await c.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false)", [userId]);
      return c;
    };
    const a = await asUser(userA);
    const b = await asUser(userB);
    assert.equal((await a.query('select id from hub_connections where id=$1', [connectionId])).rows.length, 1);
    assert.equal((await a.query('select device_id from hub_devices where connection_id=$1', [connectionId])).rows.length, 2);
    assert.equal((await b.query('select id from hub_connections')).rows.length, 0, "user B must not see user A's connection");
    assert.equal((await b.query('select device_id from hub_devices')).rows.length, 0, "user B must not see user A's devices");

    const anon = await connect('anon');
    for (const [who, c] of [['authenticated', a], ['anon', anon]]) {
      await assert.rejects(() => c.query('select id from hub_connect_requests'), /permission denied/i, `${who} must not read requests`);
      await assert.rejects(() => c.query("update hub_connections set status='active'"), /permission denied/i, `${who} must not write connections`);
      await assert.rejects(() => c.query('delete from hub_devices'), /permission denied/i, `${who} must not write devices`);
      for (const call of [
        `select hub_connect_view('${first.request_id}','${userA}')`,
        `select hub_connect_open_request('${first.request_id}','${userA}')`,
        `select hub_connect_decide('${first.request_id}','${userA}','BBBB-BBBB',true,false,5)`,
        `select hub_connect_collect('${first.request_id}','x',null,'h','p',array['notes'],0,5)`,
        `select hub_connect_touch('${randomUUID()}',null,null,null,null)`,
        `select hub_connect_disconnect('${userA}','${connectionId}',null)`,
        `select hub_connect_start('${hubId}','h','${deviceId}','d','browser','{}','c','BBBB-BBBB','x',600,10)`,
      ]) {
        await assert.rejects(() => c.query(call), /permission denied/i, `${who} must not be able to run: ${call.slice(7, 40)}`);
      }
    }

    // A signed-in account may write its own key rows. It still cannot point one at another account's connection.
    const theirs = newKey();
    await b.query("insert into hub_api_keys(key_hash, key_prefix, name) values ($1,$2,'B by hand')", [theirs.hash, theirs.prefix]);
    await assert.rejects(
      () => b.query('update hub_api_keys set hub_connection_id=$1, generation=3 where key_hash=$2', [connectionId, theirs.hash]),
      /hub_api_keys_connection_owner_fk/,
      "a key must not be attachable to another account's connection",
    );
    console.log('row-level security    : owner reads, user B sees nothing, nobody writes, functions are service-role only');
  }

  // 10. Disconnect: only the owner or a live key of the connection, never a hand-made key, and twice is once.
  {
    assert.equal((await svc.query('select hub_connect_disconnect($1,$2,null) as r', [userB, connectionId])).rows[0].r, 'not_found', "user B must not end user A's connection");
    const legacyId = (await db.query('select id from hub_api_keys where key_hash=$1', [legacy.hash])).rows[0].id;
    assert.equal((await svc.query('select hub_connect_disconnect(null,null,$1) as r', [legacyId])).rows[0].r, 'legacy_key');
    assert.equal((await db.query('select status from hub_connections where id=$1', [connectionId])).rows[0].status, 'active');

    const keyId = (await db.query('select id from hub_api_keys where key_hash=$1', [secondKey.hash])).rows[0].id;
    assert.equal((await svc.query('select hub_connect_disconnect(null,null,$1) as r', [keyId])).rows[0].r, 'disconnected');
    const { rows: [ended] } = await db.query('select status, revoked_at from hub_connections where id=$1', [connectionId]);
    assert.equal(ended.status, 'revoked');
    assert.equal((await db.query('select count(*)::int as n from hub_api_keys where hub_connection_id=$1 and is_active', [connectionId])).rows[0].n, 0, 'every key of the connection must be off');

    const refused = await lookupHubKey(secondKey.fullKey, admin);
    assert.equal(refused.result, null);
    assert.equal(refused.errorMessage, "This hub's connection to Menerio was ended.");
    assert.equal((await svc.query('select hub_connect_touch($1,null,null,null,null) as r', [keyId])).rows[0].r, null);

    // Again, from Settings this time: same answer, nothing moves.
    assert.equal((await svc.query('select hub_connect_disconnect($1,$2,null) as r', [userA, connectionId])).rows[0].r, 'disconnected');
    assert.equal((await svc.query('select hub_connect_disconnect(null,null,$1) as r', [keyId])).rows[0].r, 'disconnected');
    assert.deepEqual((await db.query('select revoked_at from hub_connections where id=$1', [connectionId])).rows[0].revoked_at, ended.revoked_at);

    // Connecting once more brings the same connection back, one generation on.
    const r = await start(svc);
    const approved = await decide(svc, r.request_id, userA, r.user_code);
    assert.equal(approved.connection_id, connectionId);
    assert.equal(approved.generation, 4);
    const back = await collect(svc, r.request_id, r.verifier);
    assert.equal((await lookupHubKey(back.key.fullKey, admin)).result?.connectionId, connectionId);
    assert.equal((await lookupHubKey(secondKey.fullKey, admin)).result, null, 'the key of the ended generation stays dead');
    console.log('disconnect            : owner and live key only, idempotent, reconnect revives the connection at generation 4');
  }

  // 11. Ten minutes is ten minutes, for the page and for the hub.
  {
    const r = await start(svc, { hub: randomUUID() });
    await db.query("update hub_connect_requests set expires_at = now() - interval '1 second' where id=$1", [r.request_id]);
    assert.equal(await view(r.request_id, userA), null);
    assert.equal((await statusOf(r.request_id)).status, 'expired');
    assert.equal((await decide(svc, r.request_id, userA, r.user_code)).outcome, 'not_found');

    const late = await start(svc, { hub: randomUUID() });
    await decide(svc, late.request_id, userA, late.user_code);
    await db.query("update hub_connect_requests set expires_at = now() - interval '1 second' where id=$1", [late.request_id]);
    const polled = await collect(svc, late.request_id, late.verifier);
    assert.equal(polled.outcome, 'not_collectable', 'an approval nobody collected in time must not yield a key');
    assert.equal(polled.status, 'expired');
    assert.equal(protocol.tokenErrorForStatus((await collect(svc, randomUUID(), newVerifier())).status), 'expired_token', 'an unknown request reads as expired');
  }

  // 12. The same flow through the real edge function, over HTTP, to pin what the hub and the page actually see.
  {
    const logged = [];
    const serve = await serveFunction('supabase/functions/hub-connect/index.ts', svc, db, logged);
    const call = async (method, path, { body, headers = {} } = {}) => {
      const res = await serve(new Request(`https://synthetic.invalid/hub-connect/${path}`, {
        method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${run.charCodeAt(0) % 250}`, ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      assert.equal(res.headers.get('cache-control'), 'no-store', `${path} must not be cacheable`);
      return { status: res.status, body: await res.json() };
    };
    const session = (userId) => ({ authorization: `Bearer session:${userId}` });
    const noGap = (requestId) => db.query('update hub_connect_requests set last_poll_at = null where id=$1', [requestId]);

    const httpHub = randomUUID();
    const verifier = newVerifier();
    const startBody = {
      hub_id: httpHub, hub_name: 'HTTP hub', device_id: deviceId, device_name: 'Test laptop',
      code_challenge: challengeOf(verifier), code_challenge_method: 'S256', flow: 'browser', wants: { context: true, documents: false },
    };
    assert.equal((await call('POST', 'start', { body: { ...startBody, code_challenge_method: 'plain' } })).status, 400);
    const started = await call('POST', 'start', { body: startBody });
    assert.equal(started.status, 200);
    httpRequests.push(started.body.request_id);
    assert.match(started.body.user_code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.equal(started.body.verification_uri, 'https://menerio.com/connect-hub');
    assert.equal(started.body.verification_uri_complete, `https://menerio.com/connect-hub?request=${started.body.request_id}&code=${started.body.user_code}`);
    assert.equal(started.body.expires_in, 600);
    assert.equal(started.body.interval, 3);
    const storedCaller = (await db.query('select caller_hash from hub_connect_requests where id=$1', [started.body.request_id])).rows[0].caller_hash;
    assert.match(storedCaller, /^[0-9a-f]{64}$/, 'the caller address must be stored as a hash');
    const id = started.body.request_id;

    assert.equal((await call('GET', `request?request_id=${id}`)).status, 401);
    const page = await call('GET', `request?request_id=${id}`, { headers: session(userA) });
    assert.equal(page.status, 200);
    assert.equal(page.body.account_label, `a-${run}@example.test`);
    assert.equal(page.body.user_code, started.body.user_code);
    assert.equal((await call('GET', `request?request_id=${id}`, { headers: session(userB) })).status, 404);
    assert.equal((await call('POST', 'approve', { headers: session(userB), body: { request_id: id, user_code: started.body.user_code, approve: true } })).status, 404);

    const pending = await call('POST', 'token', { body: { request_id: id, code_verifier: verifier, device_id: deviceId } });
    assert.deepEqual([pending.status, pending.body.error], [428, 'authorization_pending']);
    const tooSoon = await call('POST', 'token', { body: { request_id: id, code_verifier: verifier, device_id: deviceId } });
    assert.deepEqual([tooSoon.status, tooSoon.body.error], [429, 'slow_down']);

    const miss = await call('POST', 'approve', { headers: session(userA), body: { request_id: id, user_code: 'not a code', approve: true } });
    assert.deepEqual([miss.status, miss.body.error, miss.body.attempts_left], [400, 'wrong_code', 4]);
    const yes = await call('POST', 'approve', { headers: session(userA), body: { request_id: id, user_code: started.body.user_code.toLowerCase().replace('-', ' '), approve: true } });
    assert.deepEqual([yes.status, yes.body], [200, { status: 'approved' }]);

    await noGap(id);
    const wrong = await call('POST', 'token', { body: { request_id: id, code_verifier: newVerifier(), device_id: deviceId } });
    assert.deepEqual([wrong.status, wrong.body.error], [400, 'invalid_grant']);
    await noGap(id);
    const token = await call('POST', 'token', { body: { request_id: id, code_verifier: verifier, device_id: deviceId } });
    assert.equal(token.status, 200);
    assert.match(token.body.api_key, /^mnr_[0-9a-f]{48}$/);
    assert.equal(token.body.hub_id, httpHub);
    assert.equal(token.body.generation, 1);
    assert.equal(token.body.account_label, `a-${run}@example.test`);
    assert.deepEqual(token.body.scopes, SCOPES);
    assert.equal(token.body.documents, false);
    assert.equal((await db.query('select count(*)::int as n from hub_api_keys where key_hash=$1 and hub_connection_id=$2', [sha256(token.body.api_key), token.body.connection_id])).rows[0].n, 1, 'the returned key is the stored one');
    await noGap(id);
    const twice = await call('POST', 'token', { body: { request_id: id, code_verifier: verifier, device_id: deviceId } });
    assert.deepEqual([twice.status, twice.body.error], [410, 'expired_token']);

    const bearer = { authorization: `Bearer ${token.body.api_key}` };
    const status = await call('GET', 'status', { headers: { ...bearer, 'x-hub-device-id': deviceId, 'x-hub-device-name': 'Test laptop', 'x-hub-client': 'claude-code', 'x-hub-client-state': 'working' } });
    assert.equal(status.status, 200);
    assert.equal(status.body.connected, true);
    assert.equal(status.body.connection_id, token.body.connection_id);
    assert.equal(status.body.hub_name, 'HTTP hub');
    assert.equal(status.body.devices[0].clients['claude-code'].state, 'working');
    const legacyStatus = await call('GET', 'status', { headers: { authorization: `Bearer ${legacy.fullKey}` } });
    assert.deepEqual(legacyStatus.body, { connected: true, legacy_key: true, scopes: ['notes', 'profile'] });
    assert.equal((await call('GET', 'status', { headers: { authorization: `Bearer mnr_${'0'.repeat(48)}` } })).status, 401);

    assert.equal((await call('POST', 'disconnect', { headers: session(userB), body: { connection_id: token.body.connection_id } })).status, 404);
    const legacyEnd = await call('POST', 'disconnect', { headers: { authorization: `Bearer ${legacy.fullKey}` } });
    assert.deepEqual([legacyEnd.status, legacyEnd.body.error], [403, 'legacy_key']);
    assert.deepEqual((await call('POST', 'disconnect', { headers: bearer })).body, { status: 'disconnected' });
    assert.deepEqual((await call('POST', 'disconnect', { headers: bearer })).body, { status: 'disconnected' }, 'ending twice answers the same');
    assert.deepEqual((await call('POST', 'disconnect', { headers: session(userA), body: { connection_id: token.body.connection_id } })).body, { status: 'disconnected' });
    const after = await call('GET', 'status', { headers: bearer });
    assert.deepEqual([after.status, after.body.error, after.body.message], [401, 'revoked', "This hub's connection to Menerio was ended."]);

    assert.ok(!logged.join('\n').includes(token.body.api_key), 'the key must never be logged');
    assert.ok(!logged.join('\n').includes(verifier), 'the verifier must never be logged');
    console.log('over HTTP             : start, request, approve, token once, status, disconnect twice, revoked; nothing secret logged');
  }

  // 13. The hand-made key went through all of it untouched, and still opens the door.
  {
    assert.deepEqual(await legacySnapshot(), legacyBefore, 'a key that belongs to no connection must not change');
    const accepted = await lookupHubKey(legacy.fullKey, admin);
    assert.deepEqual(accepted.result?.scopes, ['notes', 'profile']);
    assert.equal(accepted.result?.connectionId, null);
    console.log('hand-made key         : unchanged and still accepted');
  }

  console.log('hub connect: approve, collect once, limits hold in parallel, generation rule enforced, RLS tight, HTTP contract as written, legacy key untouched');
} finally {
  // Deleting the two accounts takes their connections, devices, keys and claimed
  // requests with them; unclaimed requests are found by this run's caller tag.
  if (db) {
    await db.query('reset role').catch(() => {});
    await db.query("delete from auth.users where email like $1", [`%-${run}@example.test`]).catch(() => {});
    await db.query("delete from hub_connect_requests where caller_hash like $1", [`test:${run}:%`]).catch(() => {});
    await db.query('delete from hub_connect_requests where id = any($1::uuid[])', [httpRequests]).catch(() => {});
  }
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
}
