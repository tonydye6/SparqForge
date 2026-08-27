/**
 * Who owns the prose in the Asset Library's metadata panel.
 *
 * The panel beside the image ("AI Analysis" — description, Depicts, Colors,
 * Style notes) is the one Jeffrey called AI gibberish on 19 Aug. The reason it
 * reads that way is that every other intelligence field in
 * `analyzeAndStoreAsset` goes through a provenance check — refresh it only if
 * the AI wrote it last time, or if nobody has written it at all — while the
 * PROSE bypassed that system entirely:
 *
 *     description: analysis.description || asset.description,   // unconditional
 *     styleNotes:  analysis.styleNotes  || null,                // and clearing
 *
 * So a curator's own sentence about an asset was replaced by model prose on
 * every re-analysis, and an empty model answer actively blanked a style note
 * somebody had written. `description` and `styleNotes` were also missing from
 * the route's `INTELLIGENCE_FIELDS` lists, so editing them by hand never
 * recorded that a human now owned them.
 *
 * This puts the prose under the same rule as everything else. `colors` and
 * `depictedEntities` stay machine-owned — there is no editor for them — but
 * they are no longer allowed to blank a stored value with an empty answer.
 */

/** The prose fields a human can author, and therefore can own. */
export const NARRATIVE_FIELDS = ["description", "styleNotes"] as const;

export interface NarrativeAssetState {
  description: string | null;
  styleNotes: string | null;
  colors: string[] | null;
  depictedEntities: string[] | null;
}

export interface NarrativeAnalysis {
  description: string;
  styleNotes: string;
  colors: string[];
  entities: string[];
}

export interface NarrativeMerge {
  /** Only the columns that should actually change. */
  updates: Record<string, unknown>;
  /** Field names to add to `aiSuggestedFields`, marking them machine-written. */
  aiFieldsAdded: string[];
}

/** Empty, whitespace-only and null all mean "nobody has written this". */
function unwritten(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

/** One comparable form, so null, "" and "  " are all the same absence. */
function normalizeProse(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Which prose fields a PUT actually CHANGED, as opposed to merely echoed.
 *
 * The route strips analyzer ownership of every field present in the body, and
 * the Asset Library editor's `saveEdits` always sends `description` — even when
 * the curator only touched the tags. Left alone, that hands the description to
 * "the user" on any save, and `resolveNarrativeUpdates` then refuses to ever
 * refresh it: pressing Analyze to replace a bad machine description would
 * become a permanent no-op, which is the opposite of the point.
 *
 * So ownership moves on a real edit only. Trimmed, with null and "" treated as
 * the same absence, so reformatting whitespace is not an edit either.
 */
export function proseFieldsEdited(
  body: Record<string, unknown>,
  stored: Partial<Pick<NarrativeAssetState, "description" | "styleNotes">>,
): string[] {
  return NARRATIVE_FIELDS.filter((field) => {
    if (body[field] === undefined) return false;
    return normalizeProse(body[field]) !== normalizeProse(stored[field]);
  });
}

export function resolveNarrativeUpdates(
  asset: NarrativeAssetState,
  analysis: NarrativeAnalysis,
  currentAiFields: ReadonlySet<string>,
): NarrativeMerge {
  const updates: Record<string, unknown> = {};
  const aiFieldsAdded: string[] = [];

  const setProse = (field: (typeof NARRATIVE_FIELDS)[number], current: string | null, next: string) => {
    // Nothing to say is not an instruction to erase what is already there.
    if (unwritten(next)) return;
    // A person's words stand until that person changes them.
    if (!currentAiFields.has(field) && !unwritten(current)) return;
    updates[field] = next.trim();
    aiFieldsAdded.push(field);
  };

  setProse("description", asset.description, analysis.description);
  setProse("styleNotes", asset.styleNotes, analysis.styleNotes);

  // Machine-derived lists: refreshed freely, but never cleared by silence.
  if (analysis.colors.length > 0) updates.colors = analysis.colors;
  if (analysis.entities.length > 0) updates.depictedEntities = analysis.entities;

  return { updates, aiFieldsAdded };
}
