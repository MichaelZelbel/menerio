# Reproduce topic acceptance checks

Use a fresh disposable PostgreSQL 16 database named `contact_topics_test`, with pgTAP installed. The baseline below supplies only the tables and policies required by the feature. It is not a full Supabase installation. Never run these commands against production.

## Database and handler

Set `CONTACT_TOPICS_TEST_DATABASE_URL` to the local disposable connection and `CONTACT_TOPICS_TEST_ALLOW_DISPOSABLE=1`. Scripts accept only a local host and that database name. The connection must be an administrator of the disposable database.

```sh
psql "$CONTACT_TOPICS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/bootstrap-contact-topics-test.sql
psql "$CONTACT_TOPICS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20260907140000_contact_topics.sql
psql "$CONTACT_TOPICS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/migrations/20260907141000_contact_topic_conflict_http.sql
pg_prove --dbname "$CONTACT_TOPICS_TEST_DATABASE_URL" supabase/tests/contact_topics.sql
node scripts/test-contact-topics.mjs
node scripts/build-contact-topics-test.mjs
node scripts/contact-topics-test-server.mjs
```

The last command keeps the synthetic HTTP adapter running on port 4175. It loads the bundled actual MCP entrypoint and executes commands in PostgreSQL using authenticated/service roles. Its fixed synthetic keys and simplified authentication must never be exposed as a deployed service. Stop it after testing. This adapter does not implement Supabase Realtime delivery.

In another terminal set `CONTACT_TOPICS_TEST_HTTP_URL=http://127.0.0.1:4175`, then:

```sh
node scripts/test-contact-topics-http.mjs
node scripts/contact-topics-browser.mjs
```

The browser harness stays running at `http://127.0.0.1:5179` and uses the actual PersonDetail route, CSS, and topic components with synthetic auth. When PostgreSQL runs in WSL and the browser runs in Windows, use the current private WSL address for the adapter URL; the allowed port remains 4175. Run the esbuild bundler in the environment where dependencies were installed.

## Browser

Install Playwright in an isolated test-tools directory, or use an existing installation. Set `CONTACT_TOPICS_PLAYWRIGHT_MODULE` to its absolute module path if it is outside this checkout. Optionally set `CONTACT_TOPICS_CHROME` to an installed Chromium/Chrome executable.

```sh
node scripts/test-contact-topics-browser.mjs
```

This tests both browser/MCP directions and the real visible-page fallback, and writes synthetic screenshots under `.superpowers/contact-topics/screenshots`. The harness rejects external browser requests. Fixture topic titles are synthetic and prefixed; repeat runs archive prior active adapter fixtures.

## Repository checks

```sh
npm test
npx tsc --noEmit
npm run build
npm run lint
```

The checked-in [verification report](CONTACT_TOPICS_VERIFICATION.md) distinguishes actual UI tests from unit mocks and records the remaining hosted-service release checks.
