// Frontend access to the profile fact admission gate. The single source of
// truth lives with the edge functions so both runtimes split and route facts
// identically.
export * from "../../supabase/functions/_shared/profile-fact-gate";
