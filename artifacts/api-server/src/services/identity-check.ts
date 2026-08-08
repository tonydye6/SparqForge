/**
 * Did the retouch keep the character, and did it take the mark off?
 *
 * This replaces a percentage that could not answer the question. Two attempts
 * at a pixel metric both failed, in different ways and for the same underlying
 * reason: a background swap, a silhouette, and a re-framing all move enormous
 * numbers of pixels without telling you anything about whether the person in
 * the picture is still the same person. The third attempt is not a better
 * number. It is asking.
 *
 * **Two questions, deliberately separate.** A retouch can hold the character
 * perfectly and leave the swoosh exactly where it was, and it can remove every
 * mark by replacing the athlete with a different one. Folding those into a
 * single "did it work" would let each failure hide behind the other's success.
 *
 * The model sees BOTH images in one call and compares them directly, rather
 * than being asked to describe each and having us diff the descriptions. A
 * description is a lossy re-encoding, and this project has already paid for
 * that lesson at the renderer: prose about a character, placed next to that
 * character's photograph, is what destroyed identity in the first place.
 *
 * Pure: no DB, no clock, no model call. The script does the I/O.
 */

import type { TrademarkFinding } from "./trademark-scan.js";

export const IDENTITY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sameSubject: { type: "boolean" },
    subjectConfidence: { type: "number" },
    subjectNotes: { type: "string" },
    marksRemoved: { type: "boolean" },
    remainingMarks: { type: "array", maxItems: 10, items: { type: "string" } },
    unintendedChanges: { type: "array", maxItems: 10, items: { type: "string" } },
  },
  required: ["sameSubject", "subjectConfidence", "subjectNotes", "marksRemoved", "remainingMarks", "unintendedChanges"],
} as const;

/**
 * Below this, "same subject" is not an answer, it is a shrug.
 *
 * Set high because the cost is asymmetric and permanent: a false pass puts a
 * different athlete into the library under the original's name, and every
 * future generation inherits the swap. A false fail costs one more look.
 */
export const IDENTITY_CONFIDENCE_FLOOR = 0.8;

export function buildIdentitySystemPrompt(): string {
  return `You are comparing two versions of the same source asset for a game studio: the ORIGINAL and a RETOUCHED version. The retouch was supposed to remove specific third-party trademarks and change NOTHING else.

Answer only in JSON: { "sameSubject": bool, "subjectConfidence": 0.0, "subjectNotes": "...", "marksRemoved": bool, "remainingMarks": ["..."], "unintendedChanges": ["..."] }

TWO SEPARATE QUESTIONS. Answer both honestly and independently.

1. sameSubject — is the character in the retouched image the SAME INDIVIDUAL as in the original? Judge identity: face, facial structure, skin tone, hair style and colour, build, and the design of the uniform. Do NOT judge on framing, scale, position in frame, background colour, lighting, or crop; those may all differ and the answer can still be yes. A character who has been re-posed, re-lit, re-framed or placed on a different background is still the same character. A character with a different face, different hair, or a different body is NOT, no matter how similar the kit.
   - "subjectConfidence" is your honest certainty, 0 to 1. If you are unsure, say so with a low number rather than guessing; a wrong "yes" here is far more expensive than a wrong "no".
   - "subjectNotes" must name what you compared, briefly, so a human can check your reasoning.

2. marksRemoved — are the trademarks listed below actually GONE from the retouched image? List in "remainingMarks" any of them you can still see, and say where. Look carefully at small areas: shoes, shorts, sleeves, collars, headbands, and any repeated views of the same character.

"unintendedChanges" is anything else that changed and should not have: a different pose, altered kit colours, a changed number, missing equipment, added objects, a different expression. Background colour, framing and overall scale do NOT belong in this list. Report an empty array if there is nothing.

Say what you actually see. An honest "the face is different" is the most useful thing you can return.`;
}

export function buildIdentityUserPrompt(assetName: string, findings: readonly TrademarkFinding[]): string {
  const marks = findings.length > 0
    ? findings.map(f => `- ${f.mark} (was at: ${f.where})`).join("\n")
    : "- (none recorded)";
  return `Asset: "${assetName}".\n\nThe retouch was asked to remove these marks:\n${marks}\n\nThe first image is the ORIGINAL. The second is the RETOUCHED version.`;
}

export interface IdentityVerdict {
  sameSubject: boolean;
  subjectConfidence: number;
  subjectNotes: string;
  marksRemoved: boolean;
  remainingMarks: string[];
  unintendedChanges: string[];
  /** True only when both questions passed and nothing unintended was reported. */
  accept: boolean;
  /** One sentence a human can act on. Always says what it saw. */
  reason: string;
}

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 10) : [];
}

/**
 * Validate a model response into a verdict, refusing rather than coercing.
 *
 * A malformed answer becomes a REFUSAL, never a pass. The whole point of this
 * check is to be the thing standing between a wrong character and the library,
 * so it must fail closed.
 */
export function parseIdentityVerdict(raw: unknown, assetName = "this asset"): IdentityVerdict {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const sameSubject = o.sameSubject === true;
  const subjectConfidence = typeof o.subjectConfidence === "number" && Number.isFinite(o.subjectConfidence)
    ? Math.max(0, Math.min(1, o.subjectConfidence))
    : 0;
  const marksRemoved = o.marksRemoved === true;
  const remainingMarks = strList(o.remainingMarks);
  const unintendedChanges = strList(o.unintendedChanges);
  const subjectNotes = str(o.subjectNotes);

  const confident = subjectConfidence >= IDENTITY_CONFIDENCE_FLOOR;
  /*
   * `remainingMarks` overrides `marksRemoved`. A model that ticks the box and
   * then lists a swoosh it can still see has answered the question twice and
   * only one of those answers is evidence.
   */
  const reallyRemoved = marksRemoved && remainingMarks.length === 0;
  const accept = sameSubject && confident && reallyRemoved && unintendedChanges.length === 0;

  const problems: string[] = [];
  if (!sameSubject) problems.push(`the character is not the same${subjectNotes ? ` (${subjectNotes})` : ""}`);
  else if (!confident) problems.push(`only ${Math.round(subjectConfidence * 100)}% sure it is the same character, and ${Math.round(IDENTITY_CONFIDENCE_FLOOR * 100)}% is the floor`);
  if (!reallyRemoved) {
    problems.push(remainingMarks.length > 0
      ? `these marks are still visible: ${remainingMarks.join(", ")}`
      : "the marks were not reported as removed");
  }
  if (unintendedChanges.length > 0) problems.push(`something else changed: ${unintendedChanges.join(", ")}`);

  const reason = accept
    // Even a pass says what it looked at, so the decision can be audited.
    ? `Same character (${Math.round(subjectConfidence * 100)}% sure) and the marks are gone.${subjectNotes ? ` ${subjectNotes}` : ""}`
    : `Not accepted for ${assetName}: ${problems.join("; ")}.`;

  return { sameSubject, subjectConfidence, subjectNotes, marksRemoved, remainingMarks, unintendedChanges, accept, reason };
}

/** One line per image for the report. */
export function formatIdentityRow(name: string, v: IdentityVerdict): string {
  const tag = v.accept ? "ACCEPT " : "REFUSE ";
  const bits = [
    `same=${v.sameSubject ? "y" : "n"}@${Math.round(v.subjectConfidence * 100)}%`,
    `marks=${v.remainingMarks.length === 0 && v.marksRemoved ? "gone" : "still there"}`,
  ];
  if (v.unintendedChanges.length > 0) bits.push(`other=${v.unintendedChanges.length}`);
  return `  ${tag} ${name.slice(0, 46).padEnd(46)} ${bits.join(" · ")}`;
}
