/**
 * Remove everything a user has in storage before their account row goes.
 *
 * Both deletion paths (delete-my-account, admin-delete-user) used to clear the
 * `avatars` bucket and nothing else. Every clip, scan and attachment lives
 * under `note-attachments/<user_id>/`, uploaded by the service role with no
 * owner column, so no cascade and no policy ever removed them: a deleted
 * account left up to 20 MB per file behind, forever.
 *
 * Storage lists a page at a time, so this walks the prefix until a page comes
 * back empty. Best effort by design: a storage hiccup must not stop the
 * deletion of the account itself, so failures are logged and returned, never
 * thrown.
 */

interface StorageLike {
  storage: {
    from(bucket: string): {
      list(
        prefix: string,
        options?: { limit?: number; offset?: number },
      ): Promise<{ data: Array<{ name: string; id?: string | null }> | null; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
}

export const USER_STORAGE_BUCKETS = ["avatars", "note-attachments"] as const;

const PAGE = 1000;

export async function removeUserStorage(
  admin: StorageLike,
  userId: string,
  buckets: readonly string[] = USER_STORAGE_BUCKETS,
): Promise<{ removed: number; errors: string[] }> {
  let removed = 0;
  const errors: string[] = [];
  for (const bucket of buckets) {
    const store = admin.storage.from(bucket);
    // Removing shifts the listing, so always read from offset 0 until empty.
    for (let guard = 0; guard < 1000; guard++) {
      const { data, error } = await store.list(userId, { limit: PAGE, offset: 0 });
      if (error) {
        errors.push(`${bucket}: list failed: ${error.message}`);
        break;
      }
      // A folder placeholder lists with id null; the paths here are flat, but
      // skip one if it ever appears rather than try to remove it as a file.
      const files = (data ?? []).filter((f) => !("id" in f) || f.id != null);
      if (files.length === 0) break;
      const paths = files.map((f) => `${userId}/${f.name}`);
      const { error: removeError } = await store.remove(paths);
      if (removeError) {
        errors.push(`${bucket}: remove failed: ${removeError.message}`);
        break;
      }
      removed += paths.length;
      if (files.length < PAGE) break;
    }
  }
  return { removed, errors };
}
