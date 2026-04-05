import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ok = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const LEET: Record<string, string> = {
  "@": "a", "4": "a", "3": "e", "0": "o", "1": "i", "!": "i",
  "5": "s", $: "s", "7": "t", "+": "t", "8": "b", "9": "g", "#": "h",
};

function normalize(text: string): string {
  let s = text.toLowerCase();
  for (const [k, v] of Object.entries(LEET)) s = s.replaceAll(k, v);
  s = s.replace(/[^a-z0-9\s]/g, "");
  s = s.replace(/(.)\1{2,}/g, "$1$1"); // collapse repeated chars
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "email", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "phone", re: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
];

function checkPII(raw: string): string[] {
  const found: string[] = [];
  for (const p of PII_PATTERNS) {
    if (p.re.test(raw)) found.push(p.name);
    p.re.lastIndex = 0;
  }
  return found;
}

const MAX_STRIKES = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return ok({ approved: false, reason: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // --- Parse body ---
    const body = await req.json();
    const contentFields = body.content_fields ?? {};
    const action = body.action ?? "share_note";
    const itemType = body.item_type ?? "note";
    const itemId = body.item_id ?? null;

    const rawText = [contentFields.title ?? "", contentFields.content ?? ""].join(" ");
    if (!rawText.trim()) return ok({ approved: true });

    // Strip HTML tags for checking
    const plainText = rawText.replace(/<[^>]+>/g, " ");

    // --- Check suspension ---
    const { data: sus } = await admin
      .from("user_suspensions")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (sus?.suspended) {
      if (sus.suspended_until && new Date(sus.suspended_until) < new Date()) {
        await admin
          .from("user_suspensions")
          .update({ suspended: false, suspended_at: null, suspended_until: null, suspension_reason: null })
          .eq("user_id", user.id);
      } else {
        return ok({
          approved: false,
          reason: "Your account has been suspended due to repeated content policy violations.",
          support_hint: "If you believe this is a mistake, please contact support@menerio.com",
        });
      }
    }

    // --- Fetch stopwords ---
    const { data: words } = await admin
      .from("moderation_stopwords")
      .select("word, category")
      .eq("severity", "block");

    const stopwords = (words ?? []) as { word: string; category: string }[];

    // --- Normalize & match ---
    const norm = normalize(plainText);
    const matched: string[] = [];
    let hitCategory = "";

    for (const sw of stopwords) {
      const normWord = normalize(sw.word);
      if (norm.includes(normWord)) {
        matched.push(sw.word);
        if (!hitCategory) hitCategory = sw.category;
      }
    }

    // --- PII check ---
    const piiHits = checkPII(plainText);
    if (piiHits.length > 0) {
      matched.push(...piiHits.map((p) => `[PII:${p}]`));
      if (!hitCategory) hitCategory = "pii";
    }

    // --- Blocked ---
    if (matched.length > 0) {
      const snippet = plainText.slice(0, 500);

      // Log event
      await admin.from("moderation_events").insert({
        user_id: user.id,
        action,
        item_type: itemType,
        item_id: itemId,
        flagged_content: snippet,
        matched_words: matched,
        category: hitCategory,
        result: "blocked",
        tier: "stopword",
      });

      // Increment strikes
      const { data: existing } = await admin
        .from("user_suspensions")
        .select("strike_count")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        const newCount = (existing.strike_count ?? 0) + 1;
        const shouldSuspend = newCount >= MAX_STRIKES;
        await admin
          .from("user_suspensions")
          .update({
            strike_count: newCount,
            ...(shouldSuspend
              ? { suspended: true, suspended_at: new Date().toISOString(), suspension_reason: `Auto-suspended after ${newCount} content violations` }
              : {}),
          })
          .eq("user_id", user.id);
      } else {
        await admin.from("user_suspensions").insert({
          user_id: user.id,
          strike_count: 1,
        });
      }

      return ok({
        approved: false,
        reason: "This content appears to violate our Community Guidelines.",
        category: hitCategory,
        support_hint: "If you believe this is a mistake, please contact support@menerio.com",
      });
    }

    // --- Cleared ---
    await admin.from("moderation_events").insert({
      user_id: user.id,
      action,
      item_type: itemType,
      item_id: itemId,
      result: "cleared",
      tier: "stopword",
    });

    // Queue for async AI review (non-blocking)
    try {
      await admin.from("moderation_review_queue").insert({
        item_type: itemType,
        item_id: itemId,
        user_id: user.id,
        content_snapshot: plainText.slice(0, 5000),
        status: "pending",
      });
    } catch (_) {
      // fail silently — share should still proceed
    }

    return ok({ approved: true });
  } catch (err) {
    console.error("moderate-content error:", err);
    // Fail-open
    return ok({ approved: true });
  }
});
