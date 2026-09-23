/**
 * Frontend twin of `supabase/functions/_shared/mc-ranking.ts`.
 *
 * Notes mirrored out of the user's mission control (source_app "godspeed") are machine-maintained
 * files living in the same table as the notes the user wrote. They stay
 * findable, but every search surface ranks them below a native note that
 * matches equally well, so the mirror cannot win on volume alone.
 *
 * The app bundle cannot import from the edge-function tree, so the numbers are
 * repeated here. `src/lib/__tests__/mc-ranking.test.ts` imports both files and
 * fails when they disagree: change them together or not at all.
 */
export const GODSPEED_SOURCE_APP = "godspeed";

/** A mission control file's score is multiplied by this before anything is ordered. */
export const GODSPEED_SIMILARITY_FACTOR = 0.85;

/** Case- and space-insensitive, because the sender is another program. */
export function isGodspeedMirror(sourceApp?: string | null): boolean {
  return (sourceApp ?? "").trim().toLowerCase() === GODSPEED_SOURCE_APP;
}

/** The score to ORDER by. Rows without a source_app are treated as native. */
export function rankingScore(score: number, sourceApp?: string | null): number {
  return isGodspeedMirror(sourceApp) ? score * GODSPEED_SIMILARITY_FACTOR : score;
}

/** Sort comparator half: native notes before godspeed files, otherwise no opinion. */
export function compareNativeFirst(
  aSourceApp?: string | null,
  bSourceApp?: string | null,
): number {
  return Number(isGodspeedMirror(aSourceApp)) - Number(isGodspeedMirror(bSourceApp));
}
