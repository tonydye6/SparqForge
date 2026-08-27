import { describe, it, expect } from "vitest";
import { resolveNarrativeUpdates, proseFieldsEdited } from "./asset-narrative.js";

const analysis = {
  description: "A three-dimensional crown mark rendered in gold on a dark field.",
  styleNotes: "high-contrast studio render with warm metallic highlights",
  colors: ["gold", "black"],
  entities: ["Crown U crown mark"],
};

const blankAsset = {
  description: null,
  styleNotes: null,
  colors: [],
  depictedEntities: [],
};

describe("resolveNarrativeUpdates", () => {
  it("fills in the prose when a curator has written none", () => {
    const { updates, aiFieldsAdded } = resolveNarrativeUpdates(blankAsset, analysis, new Set());
    expect(updates.description).toBe(analysis.description);
    expect(updates.styleNotes).toBe(analysis.styleNotes);
    expect(aiFieldsAdded).toContain("description");
    expect(aiFieldsAdded).toContain("styleNotes");
  });

  it("does NOT overwrite a description a person wrote", () => {
    // The defect behind "the metadata bar just displays AI gibberish": a
    // curator's own words were replaced by model prose on every re-analysis.
    const curated = { ...blankAsset, description: "Official 3D CrownU logo, cleared for use." };
    const { updates, aiFieldsAdded } = resolveNarrativeUpdates(curated, analysis, new Set());
    expect(updates.description).toBeUndefined();
    expect(aiFieldsAdded).not.toContain("description");
  });

  it("does NOT overwrite style notes a person wrote", () => {
    const curated = { ...blankAsset, styleNotes: "Use on dark backgrounds only." };
    const { updates } = resolveNarrativeUpdates(curated, analysis, new Set());
    expect(updates.styleNotes).toBeUndefined();
  });

  it("refreshes prose it wrote itself last time", () => {
    const previouslyAi = { ...blankAsset, description: "An older machine description." };
    const { updates } = resolveNarrativeUpdates(previouslyAi, analysis, new Set(["description"]));
    expect(updates.description).toBe(analysis.description);
  });

  it("never blanks an existing value when the model returns nothing", () => {
    const curated = {
      description: "Official 3D CrownU logo.",
      styleNotes: "Use on dark backgrounds only.",
      colors: ["gold"],
      depictedEntities: ["crown"],
    };
    const empty = { description: "", styleNotes: "", colors: [], entities: [] };
    const { updates } = resolveNarrativeUpdates(curated, empty, new Set(["description", "styleNotes"]));
    expect(updates.description).toBeUndefined();
    expect(updates.styleNotes).toBeUndefined();
    expect(updates.colors).toBeUndefined();
    expect(updates.depictedEntities).toBeUndefined();
  });

  it("treats whitespace-only model prose as nothing at all", () => {
    const { updates, aiFieldsAdded } = resolveNarrativeUpdates(
      blankAsset,
      { ...analysis, description: "   ", styleNotes: "\n" },
      new Set(),
    );
    expect(updates.description).toBeUndefined();
    expect(updates.styleNotes).toBeUndefined();
    expect(aiFieldsAdded).not.toContain("description");
  });

  it("still refreshes the machine-derived lists, which have no human author", () => {
    const { updates } = resolveNarrativeUpdates(blankAsset, analysis, new Set());
    expect(updates.colors).toEqual(["gold", "black"]);
    expect(updates.depictedEntities).toEqual(["Crown U crown mark"]);
  });

  it("treats an empty string description as unwritten, not as a person's choice", () => {
    const { updates } = resolveNarrativeUpdates({ ...blankAsset, description: "" }, analysis, new Set());
    expect(updates.description).toBe(analysis.description);
  });
});

/**
 * Ownership of prose moves on a real edit, never on a body that merely echoes
 * the stored value. The Asset Library editor sends `description` on every save
 * (AssetLibrary.tsx `saveEdits`), so presence-based stripping would hand the
 * analyzer's own text to "the user" the first time anyone fixed a typo in the
 * tags — and `resolveNarrativeUpdates` would then refuse to refresh it ever
 * again, making Analyze a permanent no-op on exactly the field Jeffrey
 * complained about.
 */
describe("proseFieldsEdited", () => {
  const stored = { description: "Machine text.", styleNotes: "Machine notes." };

  it("reports nothing when the body only echoes what is stored", () => {
    expect(proseFieldsEdited({ description: "Machine text.", tags: ["a"] }, stored)).toEqual([]);
  });

  it("reports a field the curator actually changed", () => {
    expect(proseFieldsEdited({ description: "My own words." }, stored)).toEqual(["description"]);
  });

  it("ignores a field the body does not mention at all", () => {
    expect(proseFieldsEdited({ tags: ["a"] }, stored)).toEqual([]);
  });

  it("does not treat whitespace reformatting as an edit", () => {
    expect(proseFieldsEdited({ description: "  Machine text.  " }, stored)).toEqual([]);
  });

  it("treats null, undefined-in-store and empty string as the same absence", () => {
    expect(proseFieldsEdited({ description: "" }, { description: null })).toEqual([]);
    expect(proseFieldsEdited({ description: null }, { description: "" })).toEqual([]);
  });

  it("counts clearing a real value as an edit", () => {
    expect(proseFieldsEdited({ description: "" }, stored)).toEqual(["description"]);
  });

  it("reports both prose fields when both changed", () => {
    expect(proseFieldsEdited({ description: "a", styleNotes: "b" }, stored).sort())
      .toEqual(["description", "styleNotes"]);
  });
});
