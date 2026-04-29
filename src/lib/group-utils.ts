import type { Json } from "@/integrations/supabase/types";

export function parseArray<T>(value: Json | null | undefined): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function initials(name?: string | null) {
  return (name || "?").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export function relativeDate(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function pretty(value?: string | null) {
  return (value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
