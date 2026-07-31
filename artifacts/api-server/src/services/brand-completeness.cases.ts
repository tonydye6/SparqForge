/**
 * Phase 5 brand-record cases, shared by the vitest suite and the tsx runner.
 *
 * The assertion carrying the most weight is the scaffold-default one. A brand
 * whose primary colour is still `#3B82F6` has NOT chosen a colour, and scoring
 * it as filled would report a brand as configured while it feeds the model a
 * blue that appears nowhere in the brand. This project has already lost a day to
 * reading a default as a decision.
 */

import {
  BRAND_FIELDS,
  SOURCE_LABEL,
  TOTAL_WEIGHT,
  completenessSummary,
  formatFieldValue,
  harvestColors,
  parseFieldValue,
  isFilled,
  scoreBrand,
} from "./brand-completeness.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

const spec = (key: string) => BRAND_FIELDS.find(f => f.key === key)!;

/** A brand with everything the Studio reads actually set. */
const FULL: Record<string, unknown> = Object.fromEntries(
  BRAND_FIELDS.map(f => [f.key, f.key.startsWith("color") ? "#EB0028" : f.key === "bannedTerms" ? ["epic"] : "set"]),
);

export async function collectBrandCompletenessCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------- the scaffold-default rule
  check("a colour still at the scaffold blue is NOT filled, because nobody chose it",
    !isFilled(spec("colorPrimary"), "#3B82F6"));
  check("the scaffold check ignores case", !isFilled(spec("colorPrimary"), "#3b82f6"));
  check("a real brand colour is filled", isFilled(spec("colorPrimary"), "#EB0028"));
  check("a field with no scaffold default is filled by any text",
    isFilled(spec("voiceDescription"), "Punchy, fan-first."));

  check("empty string is not filled", !isFilled(spec("voiceDescription"), ""));
  check("whitespace only is not filled", !isFilled(spec("voiceDescription"), "   "));
  check("null and undefined are not filled",
    !isFilled(spec("voiceDescription"), null) && !isFilled(spec("voiceDescription"), undefined));
  check("an empty array is not filled", !isFilled(spec("bannedTerms"), []));
  check("a non-empty array is filled", isFilled(spec("bannedTerms"), ["epic"]));
  check("an empty object is not filled", !isFilled(spec("hashtagStrategy"), {}));
  check("a non-empty object is filled", isFilled(spec("hashtagStrategy"), { always: ["#CrownU"] }));

  // ------------------------------------------------------------- the scoring
  check("a cold brand scores zero and says so", (() => {
    const c = scoreBrand({});
    return c.score === 0 && c.cold && c.filledCount === 0;
  })());
  check("a fully set brand scores 100", (() => {
    const c = scoreBrand(FULL);
    return c.score === 100 && c.missing.length === 0 && !c.cold;
  })());
  check("a brand at scaffold colours is still cold on those fields", (() => {
    const c = scoreBrand({ colorPrimary: "#3B82F6", colorSecondary: "#1E3A5F" });
    return c.score === 0;
  })());
  check("the score is weighted, not a plain field count", (() => {
    // characterStyleRules is worth more than colorBackground, so setting it alone scores higher.
    const a = scoreBrand({ characterStyleRules: "hold the character" }).score;
    const b = scoreBrand({ colorBackground: "#111111" }).score;
    return a > b;
  })());
  check("weights sum to the declared total",
    BRAND_FIELDS.reduce((n, f) => n + f.weight, 0) === TOTAL_WEIGHT);
  check("every field states what it costs when missing",
    BRAND_FIELDS.every(f => f.costWhenMissing.length > 20));
  check("every field names the stage that reads it, so the cost is traceable",
    BRAND_FIELDS.every(f => f.consumedBy.length > 0));
  check("missing fields are ordered worst-cost first, so the next action is obvious", (() => {
    const c = scoreBrand({});
    return c.missing[0]!.spec.weight >= c.missing[c.missing.length - 1]!.spec.weight;
  })());

  // ---------------------------------------------------------- the provenance
  check("a filled field defaults to 'you' when provenance is silent",
    scoreBrand({ voiceDescription: "x" }).fields.find(f => f.spec.key === "voiceDescription")!.source === "user");
  check("a field extracted from the guide is labelled as such",
    scoreBrand({ voiceDescription: "x" }, { voiceDescription: "guide" })
      .fields.find(f => f.spec.key === "voiceDescription")!.source === "guide");
  /*
   * Stale provenance is the trap: a value cleared after being extracted would
   * otherwise keep claiming the guide decided something that is no longer there.
   */
  check("an EMPTY field reads as never set, whatever the provenance map claims",
    scoreBrand({ voiceDescription: "" }, { voiceDescription: "guide" })
      .fields.find(f => f.spec.key === "voiceDescription")!.source === "default");
  check("every source has a human label", Object.keys(SOURCE_LABEL).length === 4);

  // ------------------------------------------------------------- the summary
  check("a cold brand's summary offers a way in rather than scolding", (() => {
    const s = completenessSummary(scoreBrand({}));
    return s.includes("Nothing is set yet") && !s.toLowerCase().includes("incomplete");
  })());
  check("a complete brand's summary says nothing is guessed",
    completenessSummary(scoreBrand(FULL)).includes("Nothing is being guessed"));
  check("a partial summary names the biggest gap AND its cost", (() => {
    const s = completenessSummary(scoreBrand({ voiceDescription: "x" }));
    return s.includes("character and style rules") && s.includes("invents a lookalike");
  })());

  // -------------------------------------------------------------- harvesting
  check("the most common colour across assets ranks first",
    harvestColors([["#eb0028"], ["#eb0028"], ["#00a19c"]])[0]!.color === "#eb0028");
  check("a colour repeated inside ONE asset counts once, so one asset cannot decide the palette",
    harvestColors([["#eb0028", "#eb0028", "#eb0028"], ["#00a19c"], ["#00a19c"]])[0]!.color === "#00a19c");
  check("non-hex junk is ignored", harvestColors([["red", "not-a-colour", "#00a19c"]]).length === 1);
  check("shorthand hex is ignored rather than guessed at", harvestColors([["#fff"]]).length === 0);
  check("harvesting is capped", harvestColors([["#111111","#222222","#333333","#444444","#555555","#666666","#777777"]], 3).length === 3);
  check("no assets means no suggestions", harvestColors([]).length === 0);
  check("ties break deterministically rather than by insertion order", (() => {
    const a = harvestColors([["#00a19c"], ["#eb0028"]]).map(x => x.color).join();
    const b = harvestColors([["#eb0028"], ["#00a19c"]]).map(x => x.color).join();
    return a === b;
  })());

  // ------------------------------------------------- typed fields, not strings
  /*
   * Found by walking the screen: hashtagStrategy rendered as "[object Object]",
   * and worse, every field was SAVED as a plain string. bannedTerms is a text[]
   * and hashtagStrategy is jsonb, so the first edit of either would have pushed
   * a string into a column that cannot hold one. These refuse rather than coerce,
   * because "it saved" is the worst possible feedback for a write that destroyed
   * the value.
   */
  {
    const list = spec("bannedTerms");
    const json = spec("hashtagStrategy");
    const color = spec("colorPrimary");
    const text = spec("voiceDescription");

    check("a list is shown comma separated", formatFieldValue(list, ["epic", "insane"]) === "epic, insane");
    check("JSON is shown as JSON, not as [object Object]",
      formatFieldValue(json, { always_include: ["#CrownU"] }) === '{"always_include":["#CrownU"]}');
    check("null shows as empty rather than the word null", formatFieldValue(text, null) === "");

    check("a typed list parses to an ARRAY, which is what the column holds", (() => {
      const r = parseFieldValue(list, "epic, insane ,  ");
      return r.ok && Array.isArray(r.value) && (r.value as string[]).length === 2;
    })());
    check("an empty list parses to an empty array, not to a blank string", (() => {
      const r = parseFieldValue(list, "");
      return r.ok && Array.isArray(r.value) && (r.value as string[]).length === 0;
    })());

    check("valid JSON parses to an object", (() => {
      const r = parseFieldValue(json, '{"always_include":["#CrownU"]}');
      return r.ok && typeof r.value === "object";
    })());
    check("invalid JSON is REFUSED rather than saved as a string",
      !parseFieldValue(json, "{not json").ok);
    check("a JSON array is refused, because this column holds an object",
      !parseFieldValue(json, '["#CrownU"]').ok);
    check("a bare JSON string is refused", !parseFieldValue(json, '"hello"').ok);
    check("empty JSON parses to an empty object", (() => {
      const r = parseFieldValue(json, "");
      return r.ok && JSON.stringify(r.value) === "{}";
    })());
    check("the JSON error shows the shape it wants rather than just saying invalid", (() => {
      const r = parseFieldValue(json, '["x"]');
      return !r.ok && r.error.includes("always_include");
    })());

    check("a six-digit hex colour parses", parseFieldValue(color, "#EB0028").ok);
    check("a bad colour is refused with the shape it wants", (() => {
      const r = parseFieldValue(color, "red");
      return !r.ok && r.error.includes("#EB0028");
    })());
    check("shorthand hex is refused rather than guessed at", !parseFieldValue(color, "#fff").ok);
    check("clearing a colour is allowed", parseFieldValue(color, "").ok);

    check("text is trimmed on the way in", (() => {
      const r = parseFieldValue(text, "  punchy  ");
      return r.ok && r.value === "punchy";
    })());
    check("every field declares a kind, so nothing is edited as a string by accident",
      BRAND_FIELDS.every(f => ["text", "color", "list", "json"].includes(f.kind)));
  }

  return cases;
}
