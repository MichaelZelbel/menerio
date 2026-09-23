/**
 * Notes synced out of Michael's Mission Control are indexed for search but never mined for
 * facts.
 *
 * Mission Control's observations folder is machine-written inference: an AI's guesses
 * about him, deliberately kept apart from the things he actually said. If the
 * fact extractor read those notes, the system would turn its own guesses into
 * claims about his life and later cite them back with the authority of
 * something he told it. Search over them is the point; extraction from them is
 * the failure.
 *
 * Pure on purpose: no Deno APIs in this file, so the Node test runner can
 * import it directly.
 */
export const GODSPEED_SOURCE_APP = "godspeed";

export function shouldExtractFacts(sourceApp?: string | null): boolean {
  return (sourceApp ?? "").trim().toLowerCase() !== GODSPEED_SOURCE_APP;
}

/**
 * True for a note that is a mirrored mission control file rather than something the user
 * wrote. The same test as above, named for the callers that are not about
 * extraction at all: search ranks a mirrored file lower, and the GitHub export
 * leaves it out, because Mission Control's own git folder is already its Markdown home.
 */
export function isGodspeedMirror(sourceApp?: string | null): boolean {
  return !shouldExtractFacts(sourceApp);
}
