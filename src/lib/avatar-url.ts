import { supabase } from "@/integrations/supabase/client";

/**
 * The URL to show for a `profiles.avatar_url` value.
 *
 * The column holds the storage PATH (`<user id>/avatar-<time>.png`). The
 * onboarding wizard stored the full public URL there for a while, and pages
 * that wrapped the value in getPublicUrl() then rendered a doubled, broken
 * address. A value that already is a URL is used as it is.
 */
export function avatarPublicUrl(pathOrUrl: string | null | undefined): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return supabase.storage.from("avatars").getPublicUrl(pathOrUrl).data.publicUrl;
}
