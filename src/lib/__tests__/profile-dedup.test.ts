import { describe, expect, it } from "vitest";
import {
  buildProfileTokenIndex,
  dedupIncomingProfileValue,
} from "../../../supabase/functions/_shared/profile-dedup.ts";

describe("profile-dedup — token-aware guard", () => {
  it("skips a list-valued fact whose tokens are all already known", () => {
    const idx = buildProfileTokenIndex(
      [{ contact_id: "c1", label: "Health conditions", value: "MDD, BPD, ASD" }],
      [],
    );
    const r = dedupIncomingProfileValue({
      contactId: "c1",
      label: "Health conditions",
      value: "BPD, MDD",
      index: idx,
    });
    expect(r.action).toBe("skip");
  });

  it("rewrites a list value to just the residual (new) tokens", () => {
    const idx = buildProfileTokenIndex(
      [{ contact_id: "c1", label: "Health conditions", value: "MDD, BPD, ASD" }],
      [],
    );
    const r = dedupIncomingProfileValue({
      contactId: "c1",
      label: "Health conditions",
      value: "MDD, BPD, ASD, panic attacks",
      index: idx,
    });
    expect(r).toEqual({ action: "write", value: "panic attacks" });
  });

  it("shares allergy tokens between 'Allergies' and 'Health conditions'", () => {
    const idx = buildProfileTokenIndex(
      [{ contact_id: "c1", label: "Allergies", value: "peanut allergy" }],
      [],
    );
    const r = dedupIncomingProfileValue({
      contactId: "c1",
      label: "Health conditions",
      value: "peanut allergy",
      index: idx,
    });
    expect(r.action).toBe("skip");
  });

  it("keeps exact-duplicate behavior for non-list labels", () => {
    const idx = buildProfileTokenIndex(
      [{ contact_id: "c1", label: "Current city", value: "Berlin" }],
      [],
    );
    expect(
      dedupIncomingProfileValue({
        contactId: "c1",
        label: "Current city",
        value: "Berlin",
        index: idx,
      }).action,
    ).toBe("skip");
  });

  it("enforces singleton labels — a second 'Current city' is skipped", () => {
    const idx = buildProfileTokenIndex(
      [{ contact_id: "c1", label: "Current city", value: "Berlin" }],
      [],
    );
    expect(
      dedupIncomingProfileValue({
        contactId: "c1",
        label: "Current city",
        value: "Munich",
        index: idx,
      }).action,
    ).toBe("skip");
  });

  it("updates the index so later facts in the same batch dedup against earlier writes", () => {
    const idx = buildProfileTokenIndex([], []);
    const first = dedupIncomingProfileValue({
      contactId: "c1",
      label: "Favorite food",
      value: "hotpot, dumplings",
      index: idx,
    });
    expect(first.action).toBe("write");
    const second = dedupIncomingProfileValue({
      contactId: "c1",
      label: "Favorite food",
      value: "dumplings",
      index: idx,
    });
    expect(second.action).toBe("skip");
  });
});
