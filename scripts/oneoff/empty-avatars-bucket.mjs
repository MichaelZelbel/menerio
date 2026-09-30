#!/usr/bin/env node
/**
 * Empty (and with --delete-bucket, delete) the retired `avatars` bucket.
 * Dry run by default: prints counts only. --apply removes the files.
 * Needs SUPABASE_ACCESS_TOKEN; fetches the service key from the management API
 * at runtime and never prints it.
 */
import { createClient } from "@supabase/supabase-js";

const REF = "tjeapelvjlmbxafsmjef";
const apply = process.argv.includes("--apply");
const deleteBucket = process.argv.includes("--delete-bucket");
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error("SUPABASE_ACCESS_TOKEN is not set"); process.exit(2); }

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, { headers: { Authorization: `Bearer ${token}` } })).json();
const service = Array.isArray(keys) ? keys.find((k) => k.name === "service_role")?.api_key : undefined;
if (!service) { console.error("service_role key not returned by the management API"); process.exit(2); }
const db = createClient(`https://${REF}.supabase.co`, service, { auth: { persistSession: false } });
const bucket = db.storage.from("avatars");

let total = 0;
for (let guard = 0; guard < 10000; guard++) {
  const { data: folders, error } = await bucket.list("", { limit: 100, offset: apply ? 0 : guard * 100 });
  if (error) { console.error("list failed:", error.message); process.exit(1); }
  if (!folders?.length) break;
  for (const f of folders) {
    const prefix = f.id ? "" : f.name;            // a folder lists with id null
    const { data: items, error: e2 } = prefix ? await bucket.list(prefix, { limit: 1000 }) : { data: [f], error: null };
    if (e2) { console.error("list failed:", e2.message); process.exit(1); }
    const paths = (items ?? []).filter((i) => i.id).map((i) => (prefix ? `${prefix}/${i.name}` : i.name));
    total += paths.length;
    if (apply && paths.length) {
      const { error: e3 } = await bucket.remove(paths);
      if (e3) { console.error("remove failed:", e3.message); process.exit(1); }
    }
  }
  if (folders.length < 100) break;
}
console.log(`${apply ? "removed" : "would remove"} ${total} file(s) from avatars`);
if (deleteBucket) {
  const { error } = await db.storage.deleteBucket("avatars");
  if (error) { console.error("delete bucket failed:", error.message); process.exit(1); }
  console.log("avatars bucket deleted");
}
