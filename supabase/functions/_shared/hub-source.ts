/**
 * Notes synced out of Michael's hub are indexed for search but never mined for
 * facts.
 *
 * The hub's observations folder is machine-written inference: an AI's guesses
 * about him, deliberately kept apart from the things he actually said. If the
 * fact extractor read those notes, the system would turn its own guesses into
 * claims about his life and later cite them back with the authority of
 * something he told it. Search over them is the point; extraction from them is
 * the failure.
 *
 * Pure on purpose: no Deno APIs in this file, so the Node test runner can
 * import it directly.
 */
export const HUB_SOURCE_APP = "hub";

export function shouldExtractFacts(sourceApp?: string | null): boolean {
  return (sourceApp ?? "").trim().toLowerCase() !== HUB_SOURCE_APP;
}
