// Frontend access to the canonical profile schema. The single source of truth
// lives with the edge functions so both runtimes share one vocabulary.
export * from "../../supabase/functions/_shared/profile-canonical-schema";
