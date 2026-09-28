// Part C4 of the fact store go-live, automated (docs/plans/one-fact-store.md,
// section 10): the page walk-through Michael used to do by hand.
//
// Two layers, so a flaky selector can never be mistaken for a broken release:
//   1. Every page action, performed as a throwaway test user through exactly
//      the calls the page makes (write_fact, and the direct row writes of
//      src/hooks/useFacts.ts), with the resulting rows checked after each one.
//   2. A browser smoke check on the live site: sign in, open the test person,
//      see the current fact and its "History (n)".
// A failure in layer 1 is a real failure. A failure in layer 2 is reported with
// a screenshot; the go-live session looks at it before treating it as one.
//
// Creates its own test user and deletes it (and with it every row) at the end.
//
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//   SITE_URL=https://menerio.com node scripts/golive/page-walkthrough.mjs
//
// Output: one JSON line of check names and results. No fact of Michael's is
// read: the test user only ever sees its own rows.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = (process.env.SITE_URL || "https://menerio.com").replace(/\/$/, "");
if (!URL || !ANON || !SERVICE) throw new Error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const email = `golive-${Date.now()}@example.invalid`;
const password = randomBytes(18).toString("base64url");
const checks = {};
let userId = null;

async function check(name, fn) {
  try {
    await fn();
    checks[name] = "ok";
  } catch (e) {
    checks[name] = `FAIL: ${e.message}`;
  }
}

async function writeFact(user, body) {
  const { data, error } = await user.functions.invoke("normalize-profile", { body: { action: "write_fact", ...body } });
  if (error) throw new Error(`write_fact: ${error.message}`);
  return data;
}

async function facts(user, contactId, attribute) {
  const { data, error } = await user.from("profile_facts").select("*").eq("contact_id", contactId).eq("attribute", attribute);
  if (error) throw new Error(`profile_facts: ${error.message}`);
  return data;
}

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  const user = createClient(URL, ANON, { auth: { persistSession: false } });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;

  const { data: person, error: personError } = await user.from("contacts").insert({ user_id: userId, name: "Golive Test Person" }).select("id").single();
  if (personError) throw personError;
  const contact = person.id;
  const { data: today } = await user.rpc("fact_today", { p_user_id: userId });

  // ---- layer 1: every action the page offers ----------------------------
  let first;
  await check("add", async () => {
    const r = await writeFact(user, { contact_id: contact, label: "Current city", value: "Testville", category_slug: "location" });
    first = r.facts.find((f) => f.outcome === "inserted");
    assert.ok(first?.claimId, "no claim inserted");
    const [row] = await facts(user, contact, first.attribute);
    assert.equal(row.is_current, true);
    assert.equal(row.rank, "preferred");
    assert.equal(row.origin, "user_manual");
    assert.ok(row.slot_id, "no slot");
  });

  let second;
  await check("it_changed", async () => {
    const r = await writeFact(user, { contact_id: contact, label: "Current city", attribute: first.attribute, value: "Newtown", category_slug: "location", valid_from: today });
    second = r.facts.find((f) => f.outcome === "inserted");
    assert.ok(second?.claimId && second.closed === 1, "the old value was not closed");
    const rows = await facts(user, contact, first.attribute);
    assert.deepEqual(rows.filter((x) => x.is_current).map((x) => x.value), ["Newtown"]);
    assert.ok(rows.every((x) => !x.has_conflict), "two answers after a change");
  });

  await check("fix_a_mistake", async () => {
    const { error } = await user.from("claims").update({ value: "Newtown-on-Sea" }).eq("id", second.claimId);
    if (error) throw error;
    const { data } = await user.from("claims").select("value, rank, embedding").eq("id", second.claimId).single();
    assert.equal(data.value, "Newtown-on-Sea");
    assert.equal(data.rank, "preferred");
    assert.equal(data.embedding, null);
  });

  await check("pin_and_move", async () => {
    const [row] = (await facts(user, contact, first.attribute)).filter((x) => x.is_current);
    const { error } = await user.from("fact_slots").update({ is_pinned: true, category_slug: "identity" }).eq("id", row.slot_id);
    if (error) throw error;
    const [after] = (await facts(user, contact, first.attribute)).filter((x) => x.is_current);
    assert.equal(after.is_pinned, true);
    assert.equal(after.category_slug, "identity");
  });

  await check("history", async () => {
    const rows = await facts(user, contact, first.attribute);
    assert.ok(rows.filter((x) => !x.is_current).length >= 1, "no history row");
  });

  await check("no_longer_true", async () => {
    const { error } = await user.from("claims").update({ valid_to: today }).eq("id", second.claimId);
    if (error) throw error;
    const rows = await facts(user, contact, first.attribute);
    assert.equal(rows.filter((x) => x.is_current).length, 0);
    assert.equal(rows.length, 2, "a row disappeared instead of becoming history");
  });

  await check("was_wrong", async () => {
    const r = await writeFact(user, { contact_id: contact, label: "Favourite food", value: "Pasta", category_slug: "food" });
    const food = r.facts.find((f) => f.outcome === "inserted");
    const key = `contact:${contact}:${food.attribute}:pasta`;
    const sup = await user.from("ai_suggestion_suppressions").insert({
      user_id: userId, suggestion_type: "claim", target_entity_type: "claim", target_entity_id: food.claimId,
      normalized_value: "pasta", suppression_key: key,
    });
    if (sup.error) throw sup.error;
    const del = await user.from("claims").delete().eq("id", food.claimId);
    if (del.error) throw del.error;
    const again = await writeFact(user, { contact_id: contact, label: "Favourite food", value: "Pasta", category_slug: "food" });
    assert.equal(again.facts[0].outcome, "suppressed");
  });

  await check("same_value_is_a_no_op", async () => {
    await writeFact(user, { contact_id: contact, label: "Hometown", value: "Examplecity", category_slug: "location" });
    const r = await writeFact(user, { contact_id: contact, label: "Hometown", value: "examplecity ", category_slug: "location" });
    assert.equal(r.facts[0].outcome, "already_recorded");
  });

  await check("only_own_rows", async () => {
    const { count, error } = await user.from("profile_facts").select("claim_id", { count: "exact", head: true }).neq("user_id", userId);
    if (error) throw error;
    assert.equal(count, 0);
  });

  // ---- layer 2: the live page ---------------------------------------------
  await check("page_smoke", async () => {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage();
    try {
      await page.goto(`${SITE}/auth`);
      await page.fill("#signin-email", email);
      await page.fill("#signin-password", password);
      await page.getByRole("button", { name: "Sign In" }).last().click();
      await page.waitForURL(/dashboard/, { timeout: 30000 });
      await page.goto(`${SITE}/dashboard/people/${contact}`);
      await page.getByRole("tab", { name: "Profile" }).click();
      await page.getByText("Examplecity").first().waitFor({ timeout: 20000 });
      await page.getByText(/History \(\d+\)/).first().waitFor({ timeout: 20000 });
    } catch (e) {
      await page.screenshot({ path: "/tmp/golive-page-walkthrough.png", fullPage: true }).catch(() => {});
      throw new Error(`${e.message.split("\n")[0]} (screenshot: /tmp/golive-page-walkthrough.png)`);
    } finally {
      await browser.close();
    }
  });
} finally {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    checks.test_user_deleted = error ? `FAIL: ${error.message}` : "ok";
  }
  console.log(JSON.stringify(checks));
  if (Object.values(checks).some((v) => v !== "ok")) process.exitCode = 1;
}
