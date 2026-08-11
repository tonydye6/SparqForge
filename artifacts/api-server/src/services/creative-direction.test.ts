import { describe, it, expect } from "vitest";
import {
  buildSessionStyleContract,
  wrapEditInstruction,
  slotTypeForAsset,
  slotDescriptionForAsset,
  mergeReferenceSlots,
  parseDirectorOutput,
  buildOverflowDescriptors,
  mentionsMark,
  stripMarkProse,
  PERSONA_GUARANTEED_SLOTS,
} from "./creative-direction.js";
import type { ImageSlot } from "./interactions-client.js";
import type { Brand, StyleProfile, DesignerPersona, Asset } from "@workspace/db";

const baseBrand = {
  id: "b1",
  name: "Crown U",
  colorPrimary: "#F5B62E",
  colorSecondary: "#101828",
  colorAccent: "#3B82F6",
  colorBackground: "#0A0A0F",
  characterStyleRules: "Mascots always wear the gold crown.",
  imagenPrefix: "Bold collegiate esports energy.",
  negativePrompt: "gore, gambling imagery",
  tasteGuidance: "The team prefers calm backgrounds.",
} as unknown as Brand;

const emptyBrand = {
  id: "b2",
  name: "Blank Co",
  colorPrimary: "",
  colorSecondary: "",
  colorAccent: "",
  colorBackground: "",
  characterStyleRules: "",
  imagenPrefix: "",
  negativePrompt: "",
  tasteGuidance: "",
} as unknown as Brand;

const profile = {
  id: "sp1",
  name: "Neon Nights",
  styleDirection: "High-contrast neon lighting.",
  colorTreatment: "Duotone navy and gold.",
} as unknown as StyleProfile;

const persona = {
  id: "dp1",
  name: "Ava K",
  typography: "Heavy condensed italics",
  composition: "Diagonal panel structure",
  colorPhilosophy: "Two-tone with one accent",
  textureAndEffects: "Grain and halftone",
  mood: "Triumphant",
} as unknown as DesignerPersona;

function slot(id: string, type: ImageSlot["slot"] = "character"): ImageSlot {
  return { imageBuffer: Buffer.from("x"), mimeType: "image/png", slot: type, assetId: id };
}

describe("buildSessionStyleContract", () => {
  it("composes every configured section in order", () => {
    const contract = buildSessionStyleContract({ brand: baseBrand, styleProfile: profile, persona });
    expect(contract).toContain("Character/style rules: Mascots always wear the gold crown.");
    expect(contract).toContain("Brand colors: primary #F5B62E");
    expect(contract).toContain("Never include: gore, gambling imagery");
    expect(contract).toContain("Brand visual language: Bold collegiate esports energy.");
    expect(contract).toContain('Design style "Neon Nights": High-contrast neon lighting. Color treatment: Duotone navy and gold.');
    expect(contract).toContain('Designer fingerprint ("Ava K")');
    expect(contract).toContain("typography: Heavy condensed italics");
    expect(contract).toContain("Team taste guidance (learned from past approvals/rejections): The team prefers calm backgrounds.");
    expect(contract).toContain('Brand coherence: this image is for "Crown U"');
  });

  it("skips empty fields but always keeps brand coherence", () => {
    const contract = buildSessionStyleContract({ brand: emptyBrand });
    expect(contract).not.toContain("Character/style rules");
    expect(contract).not.toContain("Brand colors");
    expect(contract).toContain('Brand coherence: this image is for "Blank Co"');
  });

  it("carries the universal neon/glow ban even for an unconfigured brand", () => {
    // Tony's 2026-08-11 decree: global, not per-brand, so it must not depend
    // on negativePrompt being filled in.
    const contract = buildSessionStyleContract({ brand: emptyBrand });
    expect(contract).toContain("Never include:");
    expect(contract).toContain("neon");
    expect(contract).toContain("glow");
    const configured = buildSessionStyleContract({ brand: baseBrand });
    expect(configured).toContain("Never include: gore, gambling imagery; neon");
  });

  it("handles persona-only and profile-only configurations", () => {
    const personaOnly = buildSessionStyleContract({ brand: emptyBrand, persona });
    expect(personaOnly).toContain("Designer fingerprint");
    expect(personaOnly).not.toContain("Design style");

    const profileOnly = buildSessionStyleContract({ brand: emptyBrand, styleProfile: profile });
    expect(profileOnly).toContain("Design style");
    expect(profileOnly).not.toContain("Designer fingerprint");
  });
});

describe("wrapEditInstruction", () => {
  it("keeps the instruction primary and the contract labeled", () => {
    const wrapped = wrapEditInstruction("CONTRACT TEXT", "make the crown pop");
    expect(wrapped).toContain("STYLE CONTRACT");
    expect(wrapped).toContain("CONTRACT TEXT");
    expect(wrapped).toContain("INSTRUCTION (the user's actual request — it always wins on conflict):\nmake the crown pop");
    expect(wrapped.indexOf("CONTRACT TEXT")).toBeLessThan(wrapped.indexOf("make the crown pop"));
  });

  it("returns the bare instruction when the contract is empty", () => {
    expect(wrapEditInstruction("", "make it bolder")).toBe("make it bolder");
    expect(wrapEditInstruction("   ", "make it bolder")).toBe("make it bolder");
  });
});

describe("slotTypeForAsset", () => {
  it("maps stored classifications to slot types", () => {
    expect(slotTypeForAsset({ assetClass: "compositing", compositingOnly: false })).toBe("object");
    expect(slotTypeForAsset({ assetClass: null, compositingOnly: true })).toBe("object");
    expect(slotTypeForAsset({ assetClass: "subject_reference", compositingOnly: false })).toBe("character");
    expect(slotTypeForAsset({ assetClass: "style_reference", compositingOnly: false })).toBe("style");
    expect(slotTypeForAsset({ assetClass: null, compositingOnly: null })).toBe("object");
  });
});

describe("slotDescriptionForAsset", () => {
  const asset = {
    name: "Crown U icon",
    description: "Gold crown mark",
    characterIdentityNote: "",
    assetClass: null,
    generationRole: null,
    brandLayer: null,
    franchise: null,
  };
  it("carries the verbatim-fidelity note for object references", () => {
    expect(slotDescriptionForAsset(asset, "object")).toContain("Reproduce this exact asset faithfully");
  });
  it("asks for treatment matching on style references", () => {
    const d = slotDescriptionForAsset(asset, "style");
    expect(d).toContain("Match this asset's visual style");
    expect(d).not.toContain("Reproduce this exact asset");
  });

  it("strips mark prose from a character's identity note and instructs copy-from-image", () => {
    // The Crown U leak verbatim: a note that DESCRIBES the mark invites a
    // freehand redraw of the one asset class that must never be freehanded.
    const character = {
      ...asset,
      name: "Samantha",
      description: "Crown U tennis character",
      characterIdentityNote:
        "Dark curly hair and a confident stance. A red flaming skull logo prominently on her outfit. Always athletic build.",
      assetClass: "subject_reference",
    };
    const d = slotDescriptionForAsset(character, "character");
    expect(d).not.toContain("flaming skull");
    expect(d).toContain("Dark curly hair");
    expect(d).toContain("Always athletic build");
    expect(d).toContain("copied exactly as it appears in this attached image");
  });

  it("keeps mark words in an object slot's own description", () => {
    // The mark IS the thing being reproduced; its description may say so.
    const d = slotDescriptionForAsset(asset, "object");
    expect(d).toContain("Gold crown mark");
  });
});

describe("stripMarkProse", () => {
  it("removes only the sentences that name a mark", () => {
    expect(stripMarkProse("Tall athlete. Wears the team logo on the chest. Green eyes."))
      .toBe("Tall athlete. Green eyes.");
  });
  it("returns text without mark words untouched", () => {
    const text = "A night crowd shot with cool tones.";
    expect(stripMarkProse(text)).toBe(text);
  });
  it("returns empty when every sentence describes the mark", () => {
    expect(stripMarkProse("A flaming skull logo in red.")).toBe("");
  });
});

describe("mentionsMark", () => {
  it("recognises mark vocabulary in instructions", () => {
    expect(mentionsMark("Add the official Crown U chest logo")).toBe(true);
    expect(mentionsMark("Fix the missing wordmark")).toBe(true);
    expect(mentionsMark("Make the sky darker")).toBe(false);
  });
});

describe("mergeReferenceSlots", () => {
  it("prioritizes attachments, then director, guarantees persona slots, fills with packet", () => {
    const merged = mergeReferenceSlots({
      attached: [slot("a1")],
      director: [slot("d1"), slot("d2")],
      packet: [slot("p1"), slot("p2"), slot("p3")],
      persona: [slot("per1", "style"), slot("per2", "style"), slot("per3", "style")],
      cap: 6,
    });
    const ids = merged.map(s => s.assetId);
    expect(ids).toContain("a1");
    expect(ids).toContain("d1");
    expect(ids).toContain("per1");
    expect(ids).toContain("per2");
    expect(merged.length).toBe(6);
    // attachments always first
    expect(ids[0]).toBe("a1");
  });

  it("never exceeds the cap and drops persona overflow last", () => {
    const merged = mergeReferenceSlots({
      attached: [slot("a1"), slot("a2"), slot("a3")],
      director: [slot("d1"), slot("d2"), slot("d3")],
      packet: [],
      persona: [slot("per1", "style")],
      cap: 4,
    });
    expect(merged.length).toBe(4);
    expect(merged.map(s => s.assetId)).toEqual(["a1", "a2", "a3", "d1"]);
  });

  it("guarantees persona representation when a persona is selected", () => {
    const merged = mergeReferenceSlots({
      attached: [],
      director: [],
      packet: [slot("p1"), slot("p2"), slot("p3"), slot("p4"), slot("p5"), slot("p6")],
      persona: [slot("per1", "style"), slot("per2", "style"), slot("per3", "style")],
      cap: 6,
    });
    const ids = merged.map(s => s.assetId);
    expect(ids.filter(id => id?.startsWith("per")).length).toBe(PERSONA_GUARANTEED_SLOTS);
    expect(ids.filter(id => id?.startsWith("p") && !id.startsWith("per")).length).toBe(4);
  });

  it("dedupes by assetId with first occurrence winning", () => {
    const merged = mergeReferenceSlots({
      attached: [slot("x")],
      director: [slot("x"), slot("y")],
      packet: [slot("y"), slot("z")],
      persona: [],
      cap: 6,
    });
    expect(merged.map(s => s.assetId)).toEqual(["x", "y", "z"]);
  });
});

describe("parseDirectorOutput", () => {
  const valid = new Set(["asset-1", "asset-2"]);

  it("parses structured output and filters invented asset ids", () => {
    const raw = JSON.stringify({
      prompt: "A dramatic arena scene with the gold crown anchoring the top left corner.",
      assetSelections: [
        { assetId: "asset-1", role: "object" },
        { assetId: "made-up", role: "subject" },
      ],
      aspectRatio: "4:5",
    });
    const out = parseDirectorOutput(raw, valid);
    expect(out.usedFallback).toBe(false);
    expect(out.assetSelections).toEqual([{ assetId: "asset-1", role: "object" }]);
    expect(out.aspectRatio).toBe("4:5");
  });

  it("falls back to prose-only on unparseable output", () => {
    const out = parseDirectorOutput("A moody, cinematic scene with heavy grain and gold light.", valid);
    expect(out.usedFallback).toBe(true);
    expect(out.prompt).toContain("moody, cinematic");
    expect(out.assetSelections).toEqual([]);
    expect(out.aspectRatio).toBe("1:1");
  });

  it("falls back when required fields are missing or invalid", () => {
    const out = parseDirectorOutput(JSON.stringify({ assetSelections: [] }), valid);
    expect(out.usedFallback).toBe(true);
    const badRatio = parseDirectorOutput(
      JSON.stringify({ prompt: "A long enough prompt for the schema to accept.", aspectRatio: "2:3" }),
      valid,
    );
    expect(badRatio.usedFallback).toBe(true);
  });
});

describe("buildOverflowDescriptors", () => {
  it("renders descriptor lines for assets with text metadata", () => {
    const assets = [
      { name: "Arena crowd", description: "Night crowd shot", styleNotes: "cool tones", depictedEntities: ["crowd"], colors: ["navy"] },
      { name: "No metadata", description: "", styleNotes: null, depictedEntities: [], colors: [] },
    ] as unknown as Asset[];
    const block = buildOverflowDescriptors(assets);
    expect(block).toContain("ADDITIONAL BRAND ASSET DESCRIPTORS");
    expect(block).toContain("- Arena crowd: Night crowd shot Depicts: crowd Style: cool tones Colors: navy");
    expect(block).not.toContain("No metadata");
  });

  it("returns empty when nothing has text metadata", () => {
    const assets = [{ name: "Blank", description: "", styleNotes: null, depictedEntities: [], colors: [] }] as unknown as Asset[];
    expect(buildOverflowDescriptors(assets)).toBe("");
  });

  it("never gives a mark-class asset a prose seat", () => {
    // Strict marks (doc 41 item 4): an overflowed logo used to arrive as
    // "flaming skull logo ... incorporate their subjects and look".
    const assets = [
      { name: "Sparq skull", description: "Red flaming skull logo", styleNotes: null, depictedEntities: ["logo"], colors: ["red"], assetClass: "compositing", compositingOnly: true },
    ] as unknown as Asset[];
    expect(buildOverflowDescriptors(assets)).toBe("");
  });

  it("strips mark sentences from non-mark assets' prose", () => {
    const assets = [
      { name: "Samantha", description: "Tennis character mid-swing. Team logo on the chest.", styleNotes: "Wordmark treatment is bold.", depictedEntities: ["athlete", "crown logo"], colors: ["navy"], assetClass: "subject_reference", compositingOnly: false },
    ] as unknown as Asset[];
    const block = buildOverflowDescriptors(assets);
    expect(block).toContain("Tennis character mid-swing.");
    expect(block).not.toContain("logo");
    expect(block).not.toContain("Wordmark");
  });
});
