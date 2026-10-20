import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkMigrations, checkSql } from "../check-table-grants.mjs";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "table-grants", name), "utf8");

describe("check-table-grants", () => {
  it("passes a migration whose tables, partitions, view and serial sequence are all granted or revoked", () => {
    expect(checkSql(fixture("20261101000000_granted.sql"))).toEqual([]);
  });

  it("fails a migration that creates a table, a materialized view and a serial table without the grants", () => {
    expect(checkSql(fixture("20261101000001_missing.sql"))).toEqual([
      "table public.forgotten has no GRANT (or deliberate REVOKE) in this migration",
      "table public.counters lets anon/authenticated insert but sequence public.counters_id_seq (serial column id) has no GRANT USAGE",
      "materialized view public.forgotten_stats has no GRANT (or deliberate REVOKE) in this migration",
    ]);
  });

  it("enforces only from the cut-over version and reports older objects no migration grants", () => {
    const sql = "create table public.legacy (id uuid primary key);";
    const old = checkMigrations([{ name: "20260101000000_legacy.sql", sql }]);
    expect(old.failures).toEqual([]);
    expect(old.olderFiles).toEqual(["20260101000000_legacy.sql"]);
    expect(old.neverGranted).toEqual(["legacy"]);

    const fixedLater = checkMigrations([
      { name: "20260101000000_legacy.sql", sql },
      { name: "20260102000000_grant.sql", sql: "GRANT SELECT ON TABLE public.legacy TO authenticated;" },
    ]);
    expect(fixedLater.neverGranted).toEqual([]);

    const fresh = checkMigrations([{ name: "20261020000000_new.sql", sql }]);
    expect(fresh.failures).toEqual(["20261020000000_new.sql: table public.legacy has no GRANT (or deliberate REVOKE) in this migration"]);
  });

  it("follows drops, re-creates and renames in order when reporting older objects", () => {
    const report = checkMigrations([
      { name: "20260101000000_a.sql", sql: "create view public.v as select 1; create table public.old_name (id int); create table public.gone (id int);" },
      { name: "20260102000000_b.sql", sql: "drop view if exists public.v; create view public.v as select 2; drop table public.gone;" },
      { name: "20260103000000_c.sql", sql: "alter table public.old_name rename to new_name;" },
    ]);
    expect(report.neverGranted).toEqual(["new_name", "v"]);

    const granted = checkMigrations([
      { name: "20260101000000_a.sql", sql: "create table public.old_name (id int); grant select on public.old_name to authenticated;" },
      { name: "20260103000000_c.sql", sql: "alter table public.old_name rename to new_name;" },
    ]);
    expect(granted.neverGranted).toEqual([]);
  });

  it("accepts the marker comment for grants written with dynamic SQL", () => {
    expect(checkSql("-- table-grants: public.dyn\ncreate table public.dyn (x int);\ndo $$ begin execute format('grant select on %I to authenticated', 'dyn'); end $$;")).toEqual([]);
  });
});
