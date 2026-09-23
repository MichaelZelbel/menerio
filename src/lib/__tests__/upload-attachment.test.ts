import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserts: [] as string[],
  taken: new Set<string>(),
  removed: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      // The lookup sees nothing, as with a clash it could not see.
      select: () => ({ eq: () => ({ ilike: async () => ({ data: [], error: null }) }) }),
      insert: async (row: { filename: string }) => {
        state.inserts.push(row.filename);
        if (state.taken.has(row.filename)) return { error: { code: "23505", message: "duplicate key" } };
        state.taken.add(row.filename);
        return { error: null };
      },
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: state.removed,
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed" }, error: null }),
      }),
    },
  },
}));
import { uploadAttachment, withUniqueSuffix } from "../upload-attachment";

const png = () => new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });

beforeEach(() => { state.inserts = []; state.taken = new Set(); state.removed.mockReset(); });

describe("uploadAttachment", () => {
  it("registers a second same-named paste under a fresh name instead of failing", async () => {
    state.taken.add("image.png");
    const result = await uploadAttachment(png(), "u1");
    expect(state.inserts[0]).toBe("image.png");
    expect(result.filename).toMatch(/^image-[0-9a-f]{8}\.png$/);
    expect(state.taken.has(result.filename)).toBe(true);
    expect(state.removed).not.toHaveBeenCalled();
  });

  it("keeps the extension when suffixing", () => {
    expect(withUniqueSuffix("scan.final.pdf")).toMatch(/^scan\.final-[0-9a-f]{8}\.pdf$/);
    expect(withUniqueSuffix("README")).toMatch(/^README-[0-9a-f]{8}$/);
  });
});
