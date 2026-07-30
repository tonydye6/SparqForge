/**
 * Brief `@` mention cases, shared by the vitest suite and the tsx runner.
 *
 * The load-bearing invariant is reconciliation: the LINE is the artifact, and a
 * mention that outlives its text would silently attach an asset to generation
 * that the user believes they deleted. In a product whose entire argument is
 * that you can see what the model is using, that is the worst available bug.
 */

import {
  activeMentionQuery,
  applyMention,
  mentionsDirectiveBlock,
  normalizeMentions,
  reconcileMentions,
  roleForAssetClass,
  type BriefMention,
} from "./brief-mentions.js";

export interface Case { name: string; ok: boolean; detail?: unknown }

const m = (assetId: string, name: string, role: BriefMention["role"] = "subject"): BriefMention =>
  ({ assetId, name, role });

export async function collectBriefMentionCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  // ------------------------------------------------------------ role mapping
  check("a subject reference mentions as a subject", roleForAssetClass("subject_reference") === "subject");
  check("a style reference mentions as a style", roleForAssetClass("style_reference") === "style");
  check("a compositing asset mentions as a mark", roleForAssetClass("compositing") === "object");
  check("compositingOnly wins over the class", roleForAssetClass("subject_reference", true) === "object");
  check("an unclassified asset falls to object, never to subject",
    roleForAssetClass(null) === "object" && roleForAssetClass(undefined) === "object");

  // --------------------------------------------------------- the live query
  check("a bare @ at the start opens a picker with an empty query", (() => {
    const q = activeMentionQuery("@", 1);
    return q?.start === 0 && q.query === "";
  })());
  check("typing after the @ becomes the query", (() => {
    const q = activeMentionQuery("hello @trav", 11);
    return q?.start === 6 && q.query === "trav";
  })());
  check("the query may contain spaces, because real asset names do", (() => {
    const q = activeMentionQuery("@Crown U Logo", 13);
    return q?.query === "Crown U Logo";
  })());
  check("an @ mid-word never opens a picker, so emails are safe",
    activeMentionQuery("mail me at tony@sparq", 20) === null);
  check("a newline closes the query", activeMentionQuery("@trav\nmore", 10) === null);
  check("no @ at all means no query", activeMentionQuery("just a brief", 12) === null);
  check("a caret before the @ does not see it", activeMentionQuery("@trav", 0) === null);
  check("a very long run without a match gives up rather than scanning forever",
    activeMentionQuery("@" + "x".repeat(80), 81) === null);
  check("the nearest @ wins when there are two", (() => {
    const line = "@one and @two";
    return activeMentionQuery(line, 13)?.start === 9;
  })());

  // ------------------------------------------------------------- insertion
  {
    const line = "announce @trav";
    const active = activeMentionQuery(line, 14)!;
    const r = applyMention(line, active, 14, "Travis Dye");
    check("inserting replaces the typed query, not just appends",
      r.line === "announce @Travis Dye ", r.line);
    check("the caret lands after the inserted token, not inside the name",
      r.caret === r.line.length, { caret: r.caret, len: r.line.length });
  }
  {
    const line = "@t rest of the brief";
    const active = activeMentionQuery(line, 2)!;
    const r = applyMention(line, active, 2, "Crown U Logo (primary)");
    check("text after the caret survives insertion",
      r.line === "@Crown U Logo (primary)  rest of the brief", r.line);
  }

  // --------------------------------------------------------- reconciliation
  const mentions = [m("a", "Travis Dye"), m("b", "Crown U Logo (primary)", "object")];
  check("mentions still present in the line are kept",
    reconcileMentions("announce @Travis Dye with @Crown U Logo (primary)", mentions).length === 2);
  check("deleting the text drops the mention, so nothing is silently attached",
    reconcileMentions("announce something else", mentions).length === 0);
  check("deleting one mention keeps the other", (() => {
    const kept = reconcileMentions("announce @Travis Dye", mentions);
    return kept.length === 1 && kept[0]?.assetId === "a";
  })());
  check("a partial name does not keep the mention alive",
    reconcileMentions("announce @Travis", [m("a", "Travis Dye")]).length === 0);
  check("the same asset mentioned twice collapses to one slot",
    reconcileMentions("@Travis Dye and @Travis Dye", [m("a", "Travis Dye"), m("a", "Travis Dye")]).length === 1);
  check("a name containing regex characters is matched literally",
    reconcileMentions("use @Crown U Logo (primary)", [m("b", "Crown U Logo (primary)", "object")]).length === 1);

  // -------------------------------------------------------------- normalize
  check("a non-array payload yields no mentions", normalizeMentions("nope").length === 0);
  check("entries without an assetId are dropped",
    normalizeMentions([{ name: "x" }, { assetId: "", name: "y" }]).length === 0);
  check("entries without a name are dropped", normalizeMentions([{ assetId: "a" }]).length === 0);
  check("an unknown role falls back to object rather than being trusted",
    normalizeMentions([{ assetId: "a", name: "n", role: "villain" }])[0]?.role === "object");
  check("a valid role survives",
    normalizeMentions([{ assetId: "a", name: "n", role: "subject" }])[0]?.role === "subject");
  check("duplicate ids collapse on the way in",
    normalizeMentions([{ assetId: "a", name: "n" }, { assetId: "a", name: "n" }]).length === 1);
  check("junk inside the array does not poison the good entries",
    normalizeMentions([null, 5, { assetId: "a", name: "n", role: "style" }]).length === 1);

  // ---------------------------------------------------- the director's brief
  check("no mentions means no directive block at all", mentionsDirectiveBlock([]) === "");
  {
    const block = mentionsDirectiveBlock([m("a", "Travis Dye")]);
    check("the block says the attachments outrank the director's own picks",
      /outrank your selections/.test(block), block);
    check("with a subject attached the director is told not to pick another",
      /Do NOT select any additional asset with role "subject"/.test(block));
    check("with a subject attached the director is told not to describe it",
      /do not describe this subject's appearance/.test(block));
  }
  {
    const block = mentionsDirectiveBlock([m("b", "Crown U Logo (primary)", "object")]);
    check("with no subject attached the director is not told the subject is decided",
      !/subject is already decided/.test(block), block);
    check("it is still told not to re-select what is attached",
      /Do not select them again/.test(block));
  }

  return cases;
}
