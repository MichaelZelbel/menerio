/**
 * The supabase-js client as the shared helpers receive it.
 *
 * Loose on purpose, and in one place instead of one `any` per helper: the edge
 * functions create the client from an esm.sh URL, the MCP server from an npm
 * specifier, and the Node tests hand in an in-memory fake. No single imported
 * type describes all three, and the helpers only ever call `.from()` and
 * `.rpc()`. Same convention as `DbClient` in github-pull.ts and
 * people-sync-core.ts.
 */
// deno-lint-ignore no-explicit-any
export type DbClient = any;
