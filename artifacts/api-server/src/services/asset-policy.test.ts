import { describe, it, expect } from "vitest";
import {
  checkGenerationEligibility,
  computeRankingAdjustment,
  buildConflictTagSet,
  enrichSlotDescription,
  type GenerationContext,
} from "./asset-policy.js";
import type { Asset } from "@workspace/db";

// Minimal asset fixture — only the fields the policy inspects.
function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    brandId: "b1",
    type: "visual",
    status: "approved",
    name: "Test Asset",
    tags: [],
    uploadedBy: "u1",
    usageCount: 0,
    generationAllowed: true,
    compositingOnly: false,
    assetClass: null,
    approvedChannels: [],
    approvedTemplates: [],
    conflictTags: [],
    subjectIdentityScore: null,
    styleStrengthScore: null,
    freshnessScore: null,
    referencePriorityDefault: null,
    brandLayer: null,
    generationRole: null,
    franchise: null,
    characterIdentityNote: "",
    depictedEntities: [],
    colors: [],
    description: null,
    styleNotes: null,
    fileUrl: "/uploads/test.png",
    thumbnailUrl: null,
    mimeType: "image/png",
    fileSizeBytes: null,
    content: null,
    subType: null,
    approvedBy: null,
    approvedAt: null,
    approvedForCompositing: false,
    aiAnalyzedAt: null,
    fontWeight: null,
    fontName: null,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Asset;
}

// ── Hard constraints ──────────────────────────────────────────────────────────

describe("checkGenerationEligibility — hard constraints", () => {

  it("allows a fully-compliant asset", () => {
    const result = checkGenerationEligibility(makeAsset());
    expect(result.eligible).toBe(true);
  });

  // 1. generationAllowed === false
  it("blocks assets with generationAllowed=false", () => {
    const result = checkGenerationEligibility(makeAsset({ generationAllowed: false }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Not approved for AI generation");
  });

  it("blocks generationAllowed=false even for compositing role", () => {
    const result = checkGenerationEligibility(
      makeAsset({ generationAllowed: false, compositingOnly: true }),
      {},
      "compositing",
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Not approved for AI generation");
  });

  // 2. compositingOnly / assetClass === "compositing"
  it("blocks compositingOnly assets from generation_reference role", () => {
    const result = checkGenerationEligibility(makeAsset({ compositingOnly: true }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Compositing-only");
  });

  it("blocks assetClass=compositing from generation_reference role", () => {
    const result = checkGenerationEligibility(makeAsset({ assetClass: "compositing" }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Compositing-only");
  });

  it("allows compositingOnly assets for the compositing role", () => {
    const result = checkGenerationEligibility(
      makeAsset({ compositingOnly: true }),
      {},
      "compositing",
    );
    expect(result.eligible).toBe(true);
  });

  // 3. approvedChannels gating
  it("blocks an asset not approved for the target channel", () => {
    const result = checkGenerationEligibility(
      makeAsset({ approvedChannels: ["instagram_feed"] }),
      { channel: "twitter" },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("twitter");
  });

  it("allows an asset approved for the target channel", () => {
    const result = checkGenerationEligibility(
      makeAsset({ approvedChannels: ["instagram_feed", "twitter"] }),
      { channel: "twitter" },
    );
    expect(result.eligible).toBe(true);
  });

  it("does not apply channel gating when approvedChannels is empty", () => {
    const result = checkGenerationEligibility(
      makeAsset({ approvedChannels: [] }),
      { channel: "twitter" },
    );
    expect(result.eligible).toBe(true);
  });

  it("does not apply channel gating when no channel is provided", () => {
    const result = checkGenerationEligibility(
      makeAsset({ approvedChannels: ["instagram_feed"] }),
      {},
    );
    expect(result.eligible).toBe(true);
  });

  // 4. approvedTemplates gating
  it("blocks an asset not approved for the target template", () => {
    const result = checkGenerationEligibility(
      makeAsset({ approvedTemplates: ["product-launch"] }),
      { template: "event-recap" },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("template");
  });

  it("allows an asset approved for the target template", () => {
    const result = checkGenerationEligibility(
      makeAsset({ approvedTemplates: ["product-launch", "event-recap"] }),
      { template: "event-recap" },
    );
    expect(result.eligible).toBe(true);
  });

  it("does not apply template gating when approvedTemplates is empty", () => {
    const result = checkGenerationEligibility(
      makeAsset({ approvedTemplates: [] }),
      { template: "event-recap" },
    );
    expect(result.eligible).toBe(true);
  });

  // 5. conflictTags
  it("blocks an asset whose conflict tag is already in use", () => {
    const result = checkGenerationEligibility(
      makeAsset({ conflictTags: ["mascot-owl"] }),
      { conflictTagsInUse: new Set(["mascot-owl"]) },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Conflicts");
  });

  it("allows an asset when its conflict tags don't overlap", () => {
    const result = checkGenerationEligibility(
      makeAsset({ conflictTags: ["mascot-owl"] }),
      { conflictTagsInUse: new Set(["mascot-fox"]) },
    );
    expect(result.eligible).toBe(true);
  });

  it("allows an asset with no conflict tags regardless of in-use set", () => {
    const result = checkGenerationEligibility(
      makeAsset({ conflictTags: [] }),
      { conflictTagsInUse: new Set(["mascot-owl", "team-home"]) },
    );
    expect(result.eligible).toBe(true);
  });

  it("applies constraints in order: generationAllowed first", () => {
    // Even with a channel match, generationAllowed=false wins.
    const result = checkGenerationEligibility(
      makeAsset({ generationAllowed: false, approvedChannels: ["twitter"] }),
      { channel: "twitter" },
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Not approved for AI generation");
  });

});

// ── Soft ranking adjustments ──────────────────────────────────────────────────

describe("computeRankingAdjustment", () => {

  it("returns 0 when no intelligence fields are set", () => {
    const delta = computeRankingAdjustment(makeAsset());
    expect(delta).toBe(0);
  });

  it("referencePriorityDefault=5 gives a positive boost", () => {
    const delta = computeRankingAdjustment(makeAsset({ referencePriorityDefault: 5 }));
    expect(delta).toBeGreaterThan(0);
  });

  it("referencePriorityDefault=1 gives a negative adjustment", () => {
    const delta = computeRankingAdjustment(makeAsset({ referencePriorityDefault: 1 }));
    expect(delta).toBeLessThan(0);
  });

  it("referencePriorityDefault=3 is neutral", () => {
    const delta = computeRankingAdjustment(makeAsset({ referencePriorityDefault: 3 }));
    expect(delta).toBeCloseTo(0);
  });

  it("subjectIdentityScore=5 gives the maximum subject boost", () => {
    const low = computeRankingAdjustment(makeAsset({ subjectIdentityScore: 1 }));
    const high = computeRankingAdjustment(makeAsset({ subjectIdentityScore: 5 }));
    expect(high).toBeGreaterThan(low);
    expect(high - low).toBeCloseTo(1.5);
  });

  it("styleStrengthScore=5 gives maximum style boost", () => {
    const low = computeRankingAdjustment(makeAsset({ styleStrengthScore: 1 }));
    const high = computeRankingAdjustment(makeAsset({ styleStrengthScore: 5 }));
    expect(high).toBeGreaterThan(low);
    expect(high - low).toBeCloseTo(1.0);
  });

  it("freshnessScore=5 gives a positive boost; freshnessScore=1 gives a penalty", () => {
    const stale = computeRankingAdjustment(makeAsset({ freshnessScore: 1 }));
    const fresh = computeRankingAdjustment(makeAsset({ freshnessScore: 5 }));
    expect(fresh).toBeGreaterThan(stale);
  });

  it("brandLayer=core gives a flat boost", () => {
    const noBrand = computeRankingAdjustment(makeAsset({ brandLayer: null }));
    const core = computeRankingAdjustment(makeAsset({ brandLayer: "core" }));
    expect(core - noBrand).toBeCloseTo(0.3);
  });

  it("total boost is bounded (never astronomical)", () => {
    const delta = computeRankingAdjustment(makeAsset({
      referencePriorityDefault: 5,
      subjectIdentityScore: 5,
      styleStrengthScore: 5,
      freshnessScore: 5,
      brandLayer: "core",
    }));
    // Max theoretical: 0.75 + 1.5 + 1.0 + 0.25 + 0.3 = 3.8
    expect(delta).toBeLessThan(5);
    expect(delta).toBeGreaterThan(0);
  });

});

// ── buildConflictTagSet ───────────────────────────────────────────────────────

describe("buildConflictTagSet", () => {

  it("returns empty set when no assets have conflict tags", () => {
    const set = buildConflictTagSet([makeAsset(), makeAsset()]);
    expect(set.size).toBe(0);
  });

  it("unions conflict tags from multiple assets", () => {
    const set = buildConflictTagSet([
      makeAsset({ conflictTags: ["mascot-owl"] }),
      makeAsset({ conflictTags: ["team-home", "mascot-owl"] }),
    ]);
    expect(set.has("mascot-owl")).toBe(true);
    expect(set.has("team-home")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("handles assets with null/undefined conflictTags gracefully", () => {
    const set = buildConflictTagSet([
      makeAsset({ conflictTags: null as unknown as string[] }),
      makeAsset({ conflictTags: ["tag-a"] }),
    ]);
    expect(set.has("tag-a")).toBe(true);
    expect(set.size).toBe(1);
  });

});

// ── enrichSlotDescription ────────────────────────────────────────────────────

describe("enrichSlotDescription", () => {

  it("returns base string unchanged when no enrichment fields are set", () => {
    const base = "Brand asset foo.";
    const result = enrichSlotDescription(base, makeAsset());
    expect(result).toBe(base);
  });

  it("appends brandLayer=core to the description", () => {
    const result = enrichSlotDescription("Asset.", makeAsset({ brandLayer: "core" }));
    expect(result).toContain("core brand asset");
  });

  it("appends franchise hint", () => {
    const result = enrichSlotDescription("Asset.", makeAsset({ franchise: "Crown League" }));
    expect(result).toContain("Crown League");
  });

  it("appends generationRole hint", () => {
    const result = enrichSlotDescription("Asset.", makeAsset({ generationRole: "hero" }));
    expect(result).toContain("hero");
  });

});
