import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { completeMergeVaultJobs } from "../merge-vault-jobs.ts";
import { loadPeopleData } from "../people-sync-core.ts";

describe("merge vault acknowledgements", () => {
  it.each(["conflict", "pending", "stale", "missing", "source-present", "synced"])("requires proof for %s target state", async state => {
    let completed = false;
    const db = { from(table: string) {
      let from = 0, entity = "", update = false;
      const q = { select: () => q, order: () => q, lte: () => q, maybeSingle: () => q,
        range: (offset: number) => { from = offset; return q; },
        eq: (key: string, value: string) => { if (key === "entity_id") entity = value; return q; },
        update: () => { update = true; return q; },
        then: (resolve: (value: {data: unknown;error:null}) => unknown) => {
          let data: unknown;
          if (update) { completed = true; data = null; }
          else if (table === "contact_merge_vault_jobs") data = from ? [] : [{id:"job",source_contact_id:"source",target_contact_id:"target",created_at:"2026-09-08T10:00:00Z"}];
          else if (entity === "source") data = state === "source-present" ? {id:"source-log"} : null;
          else data = state === "missing" ? null : {sync_status:state === "stale" ? "synced" : state,synced_at:state === "stale" ? "2026-09-07T10:00:00Z" : "2026-09-08T11:00:00Z"};
          return Promise.resolve({data,error:null}).then(resolve);
        } };
      return q;
    } };
    await completeMergeVaultJobs(db as unknown as SupabaseClient, "owner", "2026-09-08T12:00:00Z");
    expect(completed).toBe(state === "synced");
  });
});

it("loads all people before deciding which vault files to retire, even under a lower row cap", async () => {
  const rows = Array.from({length:1001},(_,i)=>({id:String(i)}));
  const db = { from() {
    let from = 0;
    const q = {select:()=>q,eq:()=>q,not:()=>q,in:()=>q,order:()=>q,range:(offset:number)=>{from=offset;return q;},
      then:(resolve:(value:{data:{id:string}[];error:null})=>unknown)=>Promise.resolve({data:rows.slice(from,from+3),error:null}).then(resolve)};
    return q;
  } };
  const data = await loadPeopleData(db,"owner");
  expect(Object.values(data).every(rows=>rows.length===1001)).toBe(true);
});
