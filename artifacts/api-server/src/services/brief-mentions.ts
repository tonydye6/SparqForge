/**
 * Stage 01 · Brief · `@` mentions of library assets.
 *
 * WHY THIS EXISTS, and why it is not another inference:
 *
 * Stage 03 picks the subject by asking a model to choose from a catalog. That
 * works, and a live run proved the chosen asset is now reproduced faithfully.
 * What it cannot do is know which character "Travis Dye" is, because no asset in
 * the library carries that name. It was guessing between football characters,
 * and guessing differently each run.
 *
 * v1 got this right for a reason that looked like a wart: it had a screen where
 * a HUMAN confirmed the assets before generating. `@` is v2's form of that. The
 * standing lesson from this project, recorded after three failed attempts at
 * better inference, is that the answer was to let the user state it explicitly.
 *
 * So a mention is not a hint. It is an explicit id that enters generation at the
 * TOP of the reference priority (attachments beat the director), and it is what
 * the identity lock then points at.
 *
 * Everything here is pure: no DB, no clock, no randomness.
 */

/** How far back from the caret an unterminated `@` can still be live. */
const MAX_QUERY_CHARS = 48;

/**
 * The role a mentioned asset plays in generation, from how it was classified at
 * upload. Mirrors slotTypeForDirectorRole so a mention and a director pick of
 * the same asset are treated identically downstream.
 */
export function roleForAssetClass(
  assetClass: string | null | undefined,
  compositingOnly?: boolean | null,
): "subject" | "style" | "object" {
  if (compositingOnly || assetClass === "compositing") return "object";
  if (assetClass === "style_reference") return "style";
  if (assetClass === "subject_reference") return "subject";
  /*
   * Unclassified assets fall to "object", which means "reproduce this exactly".
   * That is the conservative reading of an explicit human pick: the user pointed
   * at this picture, so render this picture. It also keeps an unclassified asset
   * out of the identity lock's subject run, so the lock never claims a character
   * on the strength of a missing field.
   */
  return "object";
}

export interface BriefMention {
  assetId: string;
  /** The display name, which is also the text token in the line. */
  name: string;
  role: "subject" | "style" | "object";
}

export interface ActiveQuery {
  /** Index of the `@` in the line. */
  start: number;
  /** Text between the `@` and the caret. May contain spaces. */
  query: string;
}

/**
 * The mention being typed at the caret, if any.
 *
 * Spaces are ALLOWED inside the query, because real asset names have them
 * ("Crown U Logo (primary)"), and a picker that stops matching at the first
 * space would be useless for exactly the assets people reach for most. The cost
 * is that an `@` typed in ordinary prose keeps a picker open while the user
 * writes; that is bounded by MAX_QUERY_CHARS and by stopping at a newline, and
 * the picker showing no matches is self-evidently ignorable.
 *
 * The `@` must start the line or follow whitespace, so an email address or a
 * handle mid-word never opens a picker.
 */
export function activeMentionQuery(line: string, caret: number): ActiveQuery | null {
  if (caret < 1 || caret > line.length) return null;
  for (let i = caret - 1; i >= 0 && caret - i <= MAX_QUERY_CHARS; i--) {
    const ch = line[i];
    if (ch === "\n") return null;
    if (ch !== "@") continue;
    const prev = i > 0 ? line[i - 1] : null;
    if (prev !== null && !/\s/.test(prev)) return null;
    return { start: i, query: line.slice(i + 1, caret) };
  }
  return null;
}

/**
 * Replace the in-progress `@query` with a settled `@Name ` token.
 *
 * Returns the caret position too, because leaving the caret where it was would
 * drop the user into the middle of the name they just inserted.
 */
export function applyMention(
  line: string,
  active: ActiveQuery,
  caret: number,
  name: string,
): { line: string; caret: number } {
  const token = `@${name} `;
  const next = line.slice(0, active.start) + token + line.slice(caret);
  return { line: next, caret: active.start + token.length };
}

/**
 * Drop mentions whose token is no longer in the line.
 *
 * The line is the artifact and the source of truth; the mention list is an index
 * onto it. Without this, deleting "@Travis" from the text would leave the asset
 * silently attached to generation, which is the worst kind of bug in a system
 * whose whole argument is that you can see what it is using. Run it on every
 * keystroke.
 *
 * Duplicate mentions of the same asset collapse to one: the same picture
 * attached twice would eat two of six reference slots for nothing.
 */
export function reconcileMentions(line: string, mentions: BriefMention[]): BriefMention[] {
  const seen = new Set<string>();
  const out: BriefMention[] = [];
  for (const m of mentions) {
    if (seen.has(m.assetId)) continue;
    if (!line.includes(`@${m.name}`)) continue;
    seen.add(m.assetId);
    out.push(m);
  }
  return out;
}

/**
 * Validate and normalise mentions arriving from a client.
 *
 * The take payload is `z.unknown()` at the route layer, so this is the only
 * thing standing between a malformed body and generation code that will happily
 * try to load whatever it is handed.
 */
export function normalizeMentions(raw: unknown): BriefMention[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefMention[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    if (typeof m.assetId !== "string" || !m.assetId.trim()) continue;
    if (typeof m.name !== "string" || !m.name.trim()) continue;
    if (seen.has(m.assetId)) continue;
    const role = m.role === "subject" || m.role === "style" || m.role === "object" ? m.role : "object";
    seen.add(m.assetId);
    out.push({ assetId: m.assetId, name: m.name, role });
  }
  return out;
}

/**
 * What the Creative Director is told about assets the user attached by hand.
 *
 * The director must know, or it selects a SECOND subject and the renderer is
 * handed two people and asked to invent how they relate. Naming them also stops
 * it re-describing them, which is the failure the identity lock exists to catch.
 */
export function mentionsDirectiveBlock(mentions: BriefMention[]): string {
  if (mentions.length === 0) return "";
  const lines = mentions.map(m => `- ${m.name} (role: ${m.role}) — chosen by the user`);
  const subjects = mentions.filter(m => m.role === "subject");
  const rule = subjects.length > 0
    ? `\nThe subject is already decided. Do NOT select any additional asset with role "subject", and do not describe this subject's appearance: its image is attached.`
    : `\nThese are already attached. Do not select them again.`;
  return `ASSETS THE USER ATTACHED EXPLICITLY (these are already in the render and outrank your selections):\n${lines.join("\n")}${rule}`;
}
