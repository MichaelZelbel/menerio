import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function synthesizeDigest(data: {
  notes: { title: string; metadata: Record<string, unknown> }[];
  openActions: { content: string; priority: string; created_at: string }[];
  overdueContacts: { name: string; days_overdue: number }[];
  userName: string;
}): Promise<string[]> {
  const prompt = `You are a personal assistant creating a daily briefing. Based on the data below, write 3-5 concise bullet points for a daily digest email. Be specific and actionable.

User: ${data.userName}

Notes captured yesterday (${data.notes.length}):
${data.notes.map((n) => `- ${n.title}`).join("\n") || "None"}

Open action items (${data.openActions.length}):
${data.openActions.slice(0, 10).map((a) => `- [${a.priority}] ${a.content}`).join("\n") || "None"}

Contacts overdue for follow-up:
${data.overdueContacts.map((c) => `- ${c.name} (${c.days_overdue} days overdue)`).join("\n") || "None"}

Return a JSON array of strings, each a single bullet point. Example: ["bullet 1", "bullet 2"]`;

  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return valid JSON with key 'bullets' containing an array of strings." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const d = await r.json();
  try {
    const parsed = JSON.parse(d.choices[0].message.content);
    return Array.isArray(parsed.bullets) ? parsed.bullets : [parsed.bullets || "No summary available."];
  } catch {
    return ["Your daily digest could not be generated. Check your notes in Menerio."];
  }
}

async function generateInAppNotifications(userId: string): Promise<void> {
  const now = new Date();

  // Check preferences
  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .single();

  // Stale action items (14+ days with no update)
  if (!prefs || prefs.notify_stale_actions !== false) {
    const staleDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleActions } = await supabase
      .from("action_items")
      .select("id, content")
      .eq("user_id", userId)
      .eq("status", "open")
      .lt("updated_at", staleDate)
      .limit(5);

    if (staleActions && staleActions.length > 0) {
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "stale_action",
        title: `${staleActions.length} stale action item${staleActions.length > 1 ? "s" : ""}`,
        body: staleActions.map((a) => a.content).slice(0, 3).join(", "),
        link: "/dashboard/actions",
      });
    }
  }

  // Overdue contacts
  if (!prefs || prefs.notify_contact_followup !== false) {
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, last_contact_date, contact_frequency_days")
      .eq("user_id", userId)
      .not("contact_frequency_days", "is", null)
      .not("last_contact_date", "is", null);

    const overdue = (contacts || []).filter((c) => {
      if (!c.last_contact_date || !c.contact_frequency_days) return false;
      const lastContact = new Date(c.last_contact_date);
      const dueDate = new Date(lastContact.getTime() + c.contact_frequency_days * 24 * 60 * 60 * 1000);
      return now > dueDate;
    });

    if (overdue.length > 0) {
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "contact_followup",
        title: `${overdue.length} contact${overdue.length > 1 ? "s" : ""} overdue for follow-up`,
        body: overdue.slice(0, 3).map((c) => c.name).join(", "),
        link: "/dashboard/people",
      });
    }
  }

  // Weekly review reminder (Fridays)
  if ((!prefs || prefs.notify_weekly_review !== false) && now.getDay() === 5) {
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "weekly_review_ready",
      title: "Time for your weekly review",
      body: "Reflect on your week's notes, themes, and action items.",
      link: "/dashboard/review",
    });
  }
}

async function processDigestForUser(userId: string, email: string, userName: string): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString();
  const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString();

  // Fetch data in parallel
  const [notesRes, actionsRes, contactsRes] = await Promise.all([
    supabase
      .from("notes")
      .select("title, metadata")
      .eq("user_id", userId)
      .eq("is_trashed", false)
      .gte("created_at", yesterdayStart)
      .lte("created_at", yesterdayEnd),
    supabase
      .from("action_items")
      .select("content, priority, created_at, due_date")
      .eq("user_id", userId)
      .eq("status", "open"),
    supabase
      .from("contacts")
      .select("name, last_contact_date, contact_frequency_days")
      .eq("user_id", userId)
      .not("contact_frequency_days", "is", null)
      .not("last_contact_date", "is", null),
  ]);

  const notes = notesRes.data || [];
  const actions = actionsRes.data || [];
  const now = new Date();
  const overdueContacts = (contactsRes.data || [])
    .filter((c) => {
      if (!c.last_contact_date || !c.contact_frequency_days) return false;
      const lastContact = new Date(c.last_contact_date);
      const dueDate = new Date(lastContact.getTime() + c.contact_frequency_days * 24 * 60 * 60 * 1000);
      return now > dueDate;
    })
    .map((c) => ({
      name: c.name,
      days_overdue: Math.floor(
        (now.getTime() - new Date(c.last_contact_date!).getTime() - c.contact_frequency_days! * 24 * 60 * 60 * 1000) /
          (24 * 60 * 60 * 1000)
      ),
    }));

  // Skip if nothing to report
  if (notes.length === 0 && actions.length === 0 && overdueContacts.length === 0) {
    return;
  }

  const bullets = await synthesizeDigest({
    notes: notes as { title: string; metadata: Record<string, unknown> }[],
    openActions: actions as { content: string; priority: string; created_at: string }[],
    overdueContacts,
    userName,
  });

  // Store as notification too
  await supabase.from("notifications").insert({
    user_id: userId,
    type: "digest",
    title: "Your daily digest is ready",
    body: bullets.join(" • "),
    link: "/dashboard",
  });

  // Send email via Resend (if configured)
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (RESEND_API_KEY) {
    const htmlBullets = bullets.map((b) => `<li style="margin-bottom:8px;color:#334155;">${b}</li>`).join("");
    const html = `
      <div style="font-family:'Inter',system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff;">
        <div style="margin-bottom:24px;">
          <div style="display:inline-block;padding:6px 12px;background:#1a56db;border-radius:8px;">
            <span style="color:#fff;font-weight:700;font-size:14px;">M</span>
          </div>
          <span style="margin-left:8px;font-weight:600;font-size:18px;color:#1e293b;">Menerio</span>
        </div>
        <h2 style="font-size:20px;font-weight:700;color:#1e293b;margin:0 0 16px;">Your Daily Digest</h2>
        <ul style="padding-left:20px;margin:0 0 24px;line-height:1.7;font-size:14px;">${htmlBullets}</ul>
        <a href="https://menerio.lovable.app/dashboard" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;">Open Menerio</a>
        <p style="margin-top:24px;font-size:12px;color:#94a3b8;">You're receiving this because you enabled daily digests in Menerio settings.</p>
      </div>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Menerio <support@menerio.com>",
        to: [email],
        subject: `Your Daily Digest — ${new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
        html,
      }),
    });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Can be triggered by cron or manually by a specific user
    let targetUserId: string | null = null;

    try {
      const body = await req.json();
      targetUserId = body.user_id || null;
    } catch {
      // No body — cron trigger, process all opted-in users
    }

    if (targetUserId) {
      // Single user (manual trigger)
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", targetUserId)
        .single();

      const { data: authUser } = await supabase.auth.admin.getUserById(targetUserId);
      const email = authUser?.user?.email;

      if (email) {
        await Promise.all([
          processDigestForUser(targetUserId, email, profile?.display_name || "there"),
          generateInAppNotifications(targetUserId),
        ]);
      }

      return json({ ok: true, processed: 1 });
    }

    // Batch: process all users with digest enabled
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id, digest_email")
      .eq("daily_digest_enabled", true);

    let processed = 0;
    for (const pref of prefs || []) {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", pref.user_id)
          .single();

        const { data: authUser } = await supabase.auth.admin.getUserById(pref.user_id);
        const email = pref.digest_email || authUser?.user?.email;

        if (email) {
          await Promise.all([
            processDigestForUser(pref.user_id, email, profile?.display_name || "there"),
            generateInAppNotifications(pref.user_id),
          ]);
          processed++;
        }
      } catch (err) {
        console.error(`Error processing user ${pref.user_id}:`, err);
      }
    }

    // Also generate in-app notifications for all users (even without digest)
    const { data: allUsers } = await supabase
      .from("profiles")
      .select("id");

    for (const u of allUsers || []) {
      const alreadyProcessed = (prefs || []).some((p) => p.user_id === u.id);
      if (!alreadyProcessed) {
        try {
          await generateInAppNotifications(u.id);
        } catch (err) {
          console.error(`Notification error for ${u.id}:`, err);
        }
      }
    }

    return json({ ok: true, digests_sent: processed, total_users: (allUsers || []).length });
  } catch (err) {
    console.error("daily-digest error:", err);
    return json({ error: err.message }, 500);
  }
});
