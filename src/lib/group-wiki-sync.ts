import { supabase } from "@/integrations/supabase/client";

type MembershipWithPerson = {
  status: string | null;
  position: number;
  contacts: { name: string | null } | null;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "person";

function replaceMembersSection(content: string, nextSection: string) {
  const normalized = content.trimEnd();
  const section = `## Members\n${nextSection.trimEnd()}\n`;
  const membersBlock = /(^|\n)## Members\n[\s\S]*?(?=\n##\s|$)/;

  if (membersBlock.test(normalized)) {
    return normalized.replace(membersBlock, `$1${section}`).trimEnd() + "\n";
  }

  return `${normalized}\n\n${section}`.trimEnd() + "\n";
}

export async function syncGroupWikiMembers(groupId: string) {
  const { data: group, error: groupError } = await supabase
    .from("contact_groups")
    .select("id, slug")
    .eq("id", groupId)
    .maybeSingle();
  if (groupError) throw groupError;
  if (!group) return;

  const { data: memberships, error: membershipsError } = await supabase
    .from("contact_group_memberships")
    .select("status, position, contacts:person_id(name)")
    .eq("group_id", groupId)
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (membershipsError) throw membershipsError;

  const lines = (((memberships || []) as unknown) as MembershipWithPerson[])
    .filter((membership) => membership.contacts?.name);
  const names = [...new Set(lines.map((membership) => membership.contacts!.name!))];
  const { data: personPages, error: personPagesError } = names.length > 0
    ? await supabase.from("wiki_pages").select("title, slug").eq("page_type", "person").in("title", names)
    : { data: [], error: null };
  if (personPagesError) throw personPagesError;
  const personSlugByName = new Map((personPages || []).map((page) => [page.title, page.slug]));

  const memberLines = lines
    .map((membership) => {
      const name = membership.contacts!.name!;
      const slug = personSlugByName.get(name) || slugify(name);
      const status = membership.status ? ` — ${membership.status.replace(/_/g, " ")}` : "";
      return `- [[${slug}]]${status}`;
    });

  const membersSection = memberLines.length > 0
    ? memberLines.join("\n")
    : "_No members yet._";

  const { data: page, error: pageError } = await supabase
    .from("wiki_pages")
    .select("id, content")
    .eq("slug", `group-${group.slug}`)
    .eq("page_type", "group")
    .maybeSingle();
  if (pageError) throw pageError;
  if (!page) return;

  const content = replaceMembersSection(page.content || "", membersSection);
  const { error: updateError } = await supabase
    .from("wiki_pages")
    .update({ content })
    .eq("id", page.id);
  if (updateError) throw updateError;

  await supabase.rpc("wiki_resync_links", { p_page_id: page.id });
}