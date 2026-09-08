// Regression entrypoint replacing the original assertions of incorrect behavior.
// Synthetic service tests only. Real DB/browser acceptance commands are documented
// in docs/CODE_REVIEW_REPAIRS_2026-09-08.md and run separately in CI.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
 'src/contexts/AuthContext.test.tsx', 'src/lib/account-query-client.test.ts',
 'src/sync/__tests__/connector.test.ts',
 'supabase/functions/_shared/__tests__/contact-topics-lifecycle.test.ts',
 'supabase/functions/_shared/__tests__/github-sync-entrypoints.test.ts'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
