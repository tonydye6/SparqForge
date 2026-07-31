/**
 * Guide-extraction cases, shared by the vitest suite and the tsx runner.
 *
 * The assertion doing the most work is the quote rule. An extracted value with
 * no traceable sentence behind it is a guess wearing the guide's authority, and
 * this record exists precisely so an automated suggestion cannot quietly become
 * brand law.
 */

import {
  EXTRACTABLE_FIELDS,
  GUIDE_RESPONSE_SCHEMA,
  buildGuideSystemPrompt,
  parseGuideCandidates,
} from "./guide-extraction.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

const wrap = (candidates: unknown[]) => ({ candidates });

export async function collectGuideExtractionCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // --------------------------------------------------------- the quote rule
  check("a candidate with a quote survives", (() => {
    const r = parseGuideCandidates(
      wrap([{ key: "voiceDescription", value: "Punchy, fan-first.", quote: "our voice is punchy and fan-first" }]), {},
    );
    return r.candidates.length === 1 && r.candidates[0]!.quote.length > 0;
  })());
  check("a candidate with NO quote is dropped, because it cannot be traced to the document", (() => {
    const r = parseGuideCandidates(wrap([{ key: "voiceDescription", value: "Punchy.", quote: "" }]), {});
    return r.candidates.length === 0 && r.rejected[0]!.reason.includes("quote");
  })());
  check("a whitespace-only quote counts as no quote",
    parseGuideCandidates(wrap([{ key: "voiceDescription", value: "x", quote: "   " }]), {}).candidates.length === 0);
  check("rejections are REPORTED rather than silently swallowed",
    parseGuideCandidates(wrap([{ key: "voiceDescription", value: "x", quote: "" }]), {}).rejected.length === 1);

  // ------------------------------------------------- validation, same as typing
  /*
   * Extraction reuses parseFieldValue, so an extracted colour must satisfy
   * exactly the constraint a typed one does. A side door with looser validation
   * than the keyboard is how bad data gets in.
   */
  check("an extracted colour must be hex, exactly as a typed one must", (() => {
    const r = parseGuideCandidates(wrap([{ key: "colorPrimary", value: "royal blue", quote: "our blue" }]), {});
    return r.candidates.length === 0 && r.rejected[0]!.reason.includes("#EB0028");
  })());
  check("a valid hex colour is accepted and typed", (() => {
    const r = parseGuideCandidates(wrap([{ key: "colorPrimary", value: "#EB0028", quote: "Outlaw Red #EB0028" }]), {});
    return r.candidates[0]!.value === "#EB0028";
  })());
  check("a list is parsed into an ARRAY, not left as a string", (() => {
    const r = parseGuideCandidates(wrap([{ key: "bannedTerms", value: "epic, insane", quote: "never say epic or insane" }]), {});
    return Array.isArray(r.candidates[0]!.value) && (r.candidates[0]!.value as string[]).length === 2;
  })());
  check("an empty value is dropped",
    parseGuideCandidates(wrap([{ key: "voiceDescription", value: "   ", quote: "q" }]), {}).candidates.length === 0);

  // ------------------------------------------------------------- the guards
  check("a field a guide cannot set is refused", (() => {
    const r = parseGuideCandidates(wrap([{ key: "defaultPersonaId", value: "x", quote: "q" }]), {});
    return r.candidates.length === 0 && r.rejected[0]!.reason.includes("not a field");
  })());
  check("the same field proposed twice keeps only the first", (() => {
    const r = parseGuideCandidates(wrap([
      { key: "voiceDescription", value: "one", quote: "a" },
      { key: "voiceDescription", value: "two", quote: "b" },
    ]), {});
    return r.candidates.length === 1 && r.rejected.some(x => x.reason.includes("more than once"));
  })());
  check("junk in the array does not poison the good entries",
    parseGuideCandidates(wrap([null, 7, { key: "voiceDescription", value: "ok", quote: "q" }]), {}).candidates.length === 1);
  check("a non-array payload yields nothing rather than throwing",
    parseGuideCandidates({ candidates: "nope" }, {}).candidates.length === 0);
  check("a missing payload yields nothing", parseGuideCandidates({}, {}).candidates.length === 0);

  // ------------------------------------------------- replacing authored work
  /*
   * Overwriting a field a person wrote, silently, is worse than not extracting
   * at all. The candidate still appears: it is flagged, and the current value
   * travels with it so the replacement is visible before it happens.
   */
  {
    const r = parseGuideCandidates(
      wrap([{ key: "voiceDescription", value: "From the guide.", quote: "q" }]),
      { voiceDescription: "What Tony wrote." },
      { voiceDescription: "user" },
    );
    check("a candidate replacing authored text is FLAGGED, not hidden",
      r.candidates[0]!.replacesAuthored === true);
    check("the current value travels with it, so the replacement is visible first",
      r.candidates[0]!.current === "What Tony wrote.");
  }
  check("replacing an EMPTY authored field is not flagged as a replacement", (() => {
    const r = parseGuideCandidates(
      wrap([{ key: "voiceDescription", value: "x", quote: "q" }]),
      { voiceDescription: "" }, { voiceDescription: "user" },
    );
    return r.candidates[0]!.replacesAuthored === false;
  })());
  check("replacing a value that came from the guide before is not flagged as authored", (() => {
    const r = parseGuideCandidates(
      wrap([{ key: "voiceDescription", value: "new", quote: "q" }]),
      { voiceDescription: "old" }, { voiceDescription: "guide" },
    );
    return r.candidates[0]!.replacesAuthored === false;
  })());

  // ------------------------------------------------------------- the prompt
  const prompt = buildGuideSystemPrompt();
  check("the prompt tells the model absence is a correct answer",
    /Absence is a correct answer/i.test(prompt), prompt.slice(0, 80));
  check("the prompt forbids guessing a hex colour the guide does not give",
    /do not guess one/i.test(prompt));
  check("the prompt demands a verbatim quote", /verbatim phrase FROM THE DOCUMENT/i.test(prompt));
  check("the prompt lists every extractable field",
    EXTRACTABLE_FIELDS.every(f => prompt.includes(f.key)));
  check("the schema constrains key to the extractable set",
    GUIDE_RESPONSE_SCHEMA.properties.candidates.items.properties.key.enum.length === EXTRACTABLE_FIELDS.length);
  check("the schema requires a quote on every item",
    GUIDE_RESPONSE_SCHEMA.properties.candidates.items.required.includes("quote"));
  check("no non-extractable field leaked into the extractable set",
    !EXTRACTABLE_FIELDS.some(f => f.key === "defaultPersonaId" || f.key === "logoFileUrl"));

  return cases;
}
