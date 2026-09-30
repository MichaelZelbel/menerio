import { describe, expect, it } from "vitest";
import { ALLOWED, checkMigrations } from "../check-admin-read-policies.mjs";

type Migration = { name: string; sql: string };

function bad(files: Migration[]): string[] {
  return checkMigrations(files).bad;
}

describe("check-admin-read-policies", () => {
  it("passes a clean owner-only policy", () => {
    expect(
      bad([
        {
          name: "0001.sql",
          sql: `CREATE POLICY "Users read own" ON public.notes FOR SELECT TO authenticated USING (user_id = auth.uid());`,
        },
      ]),
    ).toEqual([]);
  });

  it("a) catches an unquoted CREATE POLICY name, and clears it on an unquoted DROP", () => {
    const created: Migration[] = [
      {
        name: "0001.sql",
        sql: `CREATE POLICY admins_read_notes ON public.notes FOR SELECT USING (public.is_admin(auth.uid()));`,
      },
    ];
    expect(bad(created)).toEqual([`notes: "admins_read_notes" (0001.sql)`]);

    const dropped: Migration[] = [
      ...created,
      { name: "0002.sql", sql: `DROP POLICY admins_read_notes ON public.notes;` },
    ];
    expect(bad(dropped)).toEqual([]);
  });

  it("b) catches an ALTER POLICY that adds an is_admin USING clause", () => {
    const files: Migration[] = [
      {
        name: "0001.sql",
        sql: `CREATE POLICY "Users can view own events" ON public.activity_events FOR SELECT TO authenticated USING (actor_id = auth.uid());`,
      },
      {
        name: "0002.sql",
        sql: `ALTER POLICY "Users can view own events" ON public.activity_events USING (actor_id = auth.uid() OR public.is_admin(auth.uid()));`,
      },
    ];
    expect(bad(files)).toEqual([`activity_events: "Users can view own events" (0002.sql)`]);
  });

  it("c) ignores a DROP POLICY sitting inside a block comment", () => {
    const files: Migration[] = [
      {
        name: "0001.sql",
        sql: `CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));`,
      },
      {
        name: "0002.sql",
        sql: `/* Was going to drop this, held off.\nDROP POLICY "Admins can view all profiles" ON public.profiles;\n*/`,
      },
    ];
    expect(bad(files)).toEqual([`profiles: "Admins can view all profiles" (0001.sql)`]);
  });

  it("d) carries a table's policies across ALTER TABLE ... RENAME TO ..., but not a column rename", () => {
    const renamed: Migration[] = [
      {
        name: "0001.sql",
        sql: `CREATE POLICY "Admins can view all profile entries" ON public.profile_entries FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));`,
      },
      { name: "0002.sql", sql: `ALTER TABLE public.profile_entries RENAME TO profile_entries_archive;` },
    ];
    expect(bad(renamed)).toEqual([`profile_entries_archive: "Admins can view all profile entries" (0001.sql)`]);

    const columnRenameToo: Migration[] = [
      ...renamed,
      { name: "0003.sql", sql: `ALTER TABLE public.profile_entries_archive RENAME COLUMN value TO body;` },
    ];
    // A column rename must not be read as a table rename (the key must stay put).
    expect(bad(columnRenameToo)).toEqual([`profile_entries_archive: "Admins can view all profile entries" (0001.sql)`]);
  });

  it("a real drop followed by the fact-store-style rename leaves nothing behind", () => {
    const files: Migration[] = [
      {
        name: "0001.sql",
        sql: `CREATE POLICY "Admins can view all profile entries" ON public.profile_entries FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));`,
      },
      {
        name: "0002.sql",
        sql: `DO $$ BEGIN IF to_regclass('public.profile_entries') IS NOT NULL THEN DROP POLICY IF EXISTS "Admins can view all profile entries" ON public.profile_entries; END IF; END $$;`,
      },
      { name: "0003.sql", sql: `ALTER TABLE public.profile_entries RENAME TO profile_entries_archive;` },
    ];
    expect(bad(files)).toEqual([]);
  });

  it("keeps the allowlist scoped to account, billing and moderation-metadata tables", () => {
    expect(ALLOWED.has("moderation_events")).toBe(true);
    expect(ALLOWED.has("profiles")).toBe(false);
  });
});
