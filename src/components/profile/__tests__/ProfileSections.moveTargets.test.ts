import { describe, expect, it } from "vitest";
import { moveTargets } from "@/components/profile/ProfileSections";

describe("moveTargets", () => {
  it("offers the taxonomy, the subject's own sections and Other", () => {
    const slugs = moveTargets([{ slug: "vault", name: "Vault" }]).map((o) => o.slug);
    expect(slugs).toContain("identity");
    expect(slugs).toContain("vault");
    expect(slugs.at(-1)).toBeNull();
  });

  // Eleventh review: on a person's page that section is rendered read-only in
  // the relationships card, so a fact moved there could not be edited again.
  it("leaves out the sections a page renders elsewhere", () => {
    const slugs = moveTargets([{ slug: "relationships", name: "Family" }], ["relationships"]).map((o) => o.slug);
    expect(slugs).not.toContain("relationships");
    expect(slugs).toContain("identity");
  });
});
