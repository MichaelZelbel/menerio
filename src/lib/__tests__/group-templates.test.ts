import { describe, expect, it } from "vitest";
import { GROUP_TEMPLATES, getTemplateById, instantiateTemplate } from "../group-templates";

const requiredTemplateIds = [
  "dream100",
  "investor_pipeline",
  "creator_collabs",
  "customer_pipeline",
  "podcast_guests",
  "hiring_candidates",
  "advisors_mentors",
  "community_members",
];

describe("GROUP_TEMPLATES", () => {
  it("exports all required templates", () => {
    expect(GROUP_TEMPLATES.map((template) => template.id).sort()).toEqual(requiredTemplateIds.sort());
  });

  it("has all required fields for each template", () => {
    for (const template of GROUP_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.purpose).toBeTruthy();
      expect(template.type).toBeTruthy();
      expect(template.icon).toBeTruthy();
      expect(template.color).toBeTruthy();
      expect(template.stages.length).toBeGreaterThanOrEqual(4);
      expect(Object.keys(template.attributesSchema).length).toBeGreaterThan(0);
      expect(template.successCriteriaDefaults.length).toBeGreaterThan(0);
    }
  });

  it("uses unique stage IDs per template", () => {
    for (const template of GROUP_TEMPLATES) {
      const stageIds = template.stages.map((stage) => stage.id);
      expect(new Set(stageIds).size).toBe(stageIds.length);
    }
  });

  it("uses unique attribute schema keys per template", () => {
    for (const template of GROUP_TEMPLATES) {
      const keys = Object.keys(template.attributesSchema);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("instantiates a valid dream100 insert object", () => {
    const template = getTemplateById("dream100");
    expect(template).toBeDefined();

    const insert = instantiateTemplate(template!, "My Dream 100");
    expect(insert).toMatchObject({
      name: "My Dream 100",
      type: "outreach",
      template: "dream100",
      icon: "Sparkles",
    });
    expect(insert.stages.length).toBe(template!.stages.length);
    expect(insert.success_criteria.every((criterion) => criterion.current === 0)).toBe(true);
    expect(insert.attributes_schema).toBe(template!.attributesSchema);
  });
});
