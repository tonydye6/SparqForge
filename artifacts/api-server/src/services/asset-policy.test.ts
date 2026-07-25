import { describe, it, expect } from "vitest";
import {
  checkGenerationEligibility,
  checkAttachmentEligibility,
  derivePolicyRole,
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

  // generationAllowed is deliberately NOT a compositing-role constraint: brand
  // seeding, the backfill service, and AI analysis all store logos with
  // generationAllowed=false, so gating on it made every logo permanently
  // ineligible even when the user attached it explicitly.
  it("ignores generationAllowed=false for the compositing role", () => {
    const result = checkGenerationEligibility(
      makeAsset({ generationAllowed: false, compositingOnly: true, approvedForCompositing: true }),
      {},
      "compositing",
    );
    expect(result.eligible).toBe(true);
  });

  it("blocks a managed compositing row whose approvedForCompositing was turned off", () => {
    const result = checkGenerationEligibility(
      makeAsset({ assetClass: "compositing", generationAllowed: false, approvedForCompositing: false }),
      {},
      "compositing",
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Not approved for logo use");
    // The reason must name the control so the block is actionable.
    expect(result.reason).toContain("Asset Details");
  });

  it("does not block a hand-toggled compositingOnly row at the schema default", () => {
    // compositingOnly set by hand, never classified: approvedForCompositing is
    // merely at its default (false) and carries no human decision. Blocking
    // here would make the asset unusable in every role.
    const result = checkGenerationEligibility(
      makeAsset({ compositingOnly: true, assetClass: null, approvedForCompositing: false }),
      {},
      "compositing",
    );
    expect(result.eligible).toBe(true);
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
      makeAsset({ compositingOnly: true, approvedForCompositing: true }),
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

// ── Role derivation ───────────────────────────────────────────────────────────

describe("derivePolicyRole", () => {
  it("routes marks to the compositing role", () => {
    expect(derivePolicyRole(makeAsset({ compositingOnly: true }))).toBe("compositing");
    expect(derivePolicyRole(makeAsset({ assetClass: "compositing" }))).toBe("compositing");
  });

  it("routes everything else to generation_reference", () => {
    expect(derivePolicyRole(makeAsset())).toBe("generation_reference");
    expect(derivePolicyRole(makeAsset({ assetClass: "subject_reference" }))).toBe("generation_reference");
  });
});

// ── Co-pilot attachments ──────────────────────────────────────────────────────

describe("checkAttachmentEligibility", () => {
  // A logo as brand seeding / backfill / AI analysis stores it.
  const logo = () => makeAsset({
    name: "Crown U icon",
    assetClass: "compositing",
    compositingOnly: true,
    generationAllowed: false,
    approvedForCompositing: true,
  });

  it("allows an explicitly picked brand mark", () => {
    const result = checkAttachmentEligibility(logo(), {}, "explicit", "swap in the icon");
    expect(result.eligible).toBe(true);
  });

  it("allows an auto-matched mark when the instruction talks about a logo", () => {
    const result = checkAttachmentEligibility(
      logo(), {}, "auto_match",
      "replace the current crown u logo with the correct uploaded crown u icon",
    );
    expect(result.eligible).toBe(true);
  });

  it("does not auto-attach a mark on a bare brand mention", () => {
    // The regression this guards: a logo asset named after the brand would
    // otherwise be baked into every instruction naming the brand.
    const result = checkAttachmentEligibility(
      logo(), {}, "auto_match",
      "hype post for the crown u championship run",
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("pick it explicitly");
  });

  it("still honors an explicit opt-out on an explicitly picked mark", () => {
    const result = checkAttachmentEligibility(
      logo(), {}, "explicit", "add the logo",
    );
    expect(result.eligible).toBe(true);
    const blocked = checkAttachmentEligibility(
      makeAsset({ assetClass: "compositing", approvedForCompositing: false }),
      {}, "explicit", "add the logo",
    );
    expect(blocked.eligible).toBe(false);
    expect(blocked.reason).toContain("Not approved for logo use");
  });

  it("still blocks a non-mark asset the owner excluded from AI generation", () => {
    const result = checkAttachmentEligibility(
      makeAsset({ generationAllowed: false }), {}, "explicit", "use this photo",
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("Not approved for AI generation");
  });

  it("still applies channel gating to attachments", () => {
    const result = checkAttachmentEligibility(
      makeAsset({ approvedChannels: ["instagram_feed"] }),
      { channel: "twitter" },
      "explicit",
      "use this",
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("twitter");
  });

  it("applies channel gating to marks as well", () => {
    const result = checkAttachmentEligibility(
      makeAsset({
        assetClass: "compositing",
        approvedForCompositing: true,
        approvedChannels: ["linkedin"],
      }),
      { channel: "twitter" },
      "explicit",
      "add the logo",
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("twitter");
  });
});
