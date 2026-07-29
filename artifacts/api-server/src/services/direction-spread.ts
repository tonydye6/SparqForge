/**
 * Stage 02 · Direction · the designer spread.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.10 and §1.17,
 * `22_IMPLEMENTATION_PLAN.md` item 2, and the Studio artifact screen 05.
 *
 * §1.10 is the constraint that makes this stage safe: **the designer decides how
 * it is composed, the brand decides what it is made of.** A persona can never
 * overrule palette, voice, mark or sound. That is what lets one persona work
 * across four brands without homogenising them, so every card returned here
 * states what it governs and the caller renders what it cannot.
 *
 * §1.17 is the other one: a derived ranking must never outrank a human decision.
 * If the brand has a locked default director, it leads the spread regardless of
 * what the hit rates say.
 *
 * Pure by design. It takes rows and returns cards, touching no database and no
 * model, so the ranking and the statistics are verifiable on a machine where
 * vitest cannot start.
 */

/** The one card that is not a persona. Always in the spread. */
export const HOUSE_STYLE_ID = "house";

/**
 * Where House style sits when there are enough personas to place it.
 *
 * The plan says "House style always present as the fourth card". Present is the
 * invariant; fourth is the placement when a fourth position exists. With fewer
 * than three personas it lands last, because there is no fourth slot to put it
 * in and dropping it would break the invariant that matters more.
 *
 * FLAGGED: artifact screen 05 is normative here. Confirm the placement against
 * it before this ships.
 */
export const HOUSE_STYLE_INDEX = 3;

/**
 * Below this many judged signals a hit rate is not reported.
 *
 * Showing "67%" off three signals is the same error as presenting a low
 * confidence intent as fact: it invites a decision the data cannot support. The
 * card says how much signal exists instead, and the caller says "not enough yet".
 */
export const MIN_SIGNALS_FOR_HIT_RATE = 5;

/** Reaction chips that count for a designer, from TasteReactionChips.tsx. */
export const POSITIVE_REACTIONS = ["Love it", "Great colors"] as const;
export const NEGATIVE_REACTIONS = ["Off-brand", "Too busy", "Wrong tone"] as const;

/**
 * Signal types that judge a designer's output.
 *
 * `vary`, `regenerate`, `caption_edit`, `headline_edit` and `edit_instruction`
 * are deliberately NOT counted. Iterating on a take is ordinary creative work,
 * not a verdict on the director: counting `vary` as a miss would punish the
 * persona people engage with most, which would invert the ranking exactly where
 * it matters.
 */
export const JUDGING_SIGNALS = [
  "take_selected",
  "take_passed_over",
  "variant_approved",
  "variant_rejected",
  "reaction",
] as const;

export interface PersonaRow {
  id: string;
  name: string;
  description: string;
  typography: string;
  composition: string;
  colorPhilosophy: string;
  textureAndEffects: string;
  mood: string;
  referenceImages: unknown;
}

/** One taste signal, already joined to the persona that produced the variant. */
export interface SignalRow {
  personaId: string | null;
  signalType: string;
  payload?: unknown;
}

export interface HitRate {
  /** 0-1, or null when there is not enough signal to say. */
  rate: number | null;
  /** Judged signals counted. Always reported, even when rate is null. */
  n: number;
  positive: number;
  negative: number;
}

export interface SpreadCard {
  id: string;
  kind: "persona" | "house";
  name: string;
  description: string;
  /** What this card controls. Composition only, never brand substance. */
  governs: string[];
  referenceCount: number;
  hitRate: HitRate;
  /** True when the brand has locked this as its default director. */
  isBrandDefault: boolean;
}

/** Count the reference images a persona actually carries. */
export function referenceCount(referenceImages: unknown): number {
  return Array.isArray(referenceImages) ? referenceImages.length : 0;
}

function reactionPolarity(payload: unknown): "positive" | "negative" | null {
  if (!payload || typeof payload !== "object") return null;
  const reaction = (payload as Record<string, unknown>).reaction;
  if (typeof reaction !== "string") return null;
  if ((POSITIVE_REACTIONS as readonly string[]).includes(reaction)) return "positive";
  if ((NEGATIVE_REACTIONS as readonly string[]).includes(reaction)) return "negative";
  // An unrecognised chip is not evidence in either direction. Guessing here
  // would let a new chip silently skew every ranking.
  return null;
}

/** Tally one persona's judged signals into a hit rate. */
export function computeHitRate(signals: SignalRow[]): HitRate {
  let positive = 0;
  let negative = 0;

  for (const s of signals) {
    switch (s.signalType) {
      case "take_selected":
      case "variant_approved":
        positive++;
        break;
      case "take_passed_over":
      case "variant_rejected":
        negative++;
        break;
      case "reaction": {
        const polarity = reactionPolarity(s.payload);
        if (polarity === "positive") positive++;
        else if (polarity === "negative") negative++;
        break;
      }
      default:
        // Not a verdict. See JUDGING_SIGNALS.
        break;
    }
  }

  const n = positive + negative;
  return {
    rate: n >= MIN_SIGNALS_FOR_HIT_RATE ? positive / n : null,
    n,
    positive,
    negative,
  };
}

/** Group signals by the persona whose variant they judged. */
export function groupSignalsByPersona(signals: SignalRow[]): Map<string, SignalRow[]> {
  const out = new Map<string, SignalRow[]>();
  for (const s of signals) {
    // A signal with no persona judged House style or legacy output. It is real
    // data, so it is kept under the House id rather than discarded.
    const key = s.personaId ?? HOUSE_STYLE_ID;
    const list = out.get(key) ?? [];
    list.push(s);
    out.set(key, list);
  }
  return out;
}

/**
 * What a persona governs, drawn from the fields it actually filled in.
 *
 * Listing only non-empty fields keeps the card honest: a persona with nothing but
 * a mood should not claim to direct typography.
 */
export function personaGoverns(p: PersonaRow): string[] {
  const out: string[] = [];
  if (p.composition.trim()) out.push("Composition");
  if (p.typography.trim()) out.push("Typography");
  if (p.colorPhilosophy.trim()) out.push("Colour treatment");
  if (p.textureAndEffects.trim()) out.push("Texture and effects");
  if (p.mood.trim()) out.push("Mood");
  return out;
}

/**
 * What no card may govern, ever. Rendered next to the spread so §1.10 is visible
 * rather than merely true.
 */
export const BRAND_OWNED = ["Palette", "Voice", "Mark", "Sound"] as const;

export interface BuildSpreadInput {
  personas: PersonaRow[];
  signals: SignalRow[];
  defaultPersonaId: string | null;
}

/**
 * Rank the personas and place House style.
 *
 * Order:
 *   1. The brand's locked default director, if set. A human decision outranks a
 *      derived ranking (§1.17).
 *   2. Personas with a reportable hit rate, best first. Ties break on sample size
 *      then name, so the order is total and the spread does not reshuffle between
 *      requests for no reason.
 *   3. Personas without enough signal, by name. Unproven is not the same as bad,
 *      so they sit below the proven ones rather than at the bottom on a zero.
 * House style is then inserted at HOUSE_STYLE_INDEX.
 */
export function buildDirectionSpread(input: BuildSpreadInput): SpreadCard[] {
  const byPersona = groupSignalsByPersona(input.signals);

  const personaCards: SpreadCard[] = input.personas.map(p => ({
    id: p.id,
    kind: "persona" as const,
    name: p.name,
    description: p.description,
    governs: personaGoverns(p),
    referenceCount: referenceCount(p.referenceImages),
    hitRate: computeHitRate(byPersona.get(p.id) ?? []),
    isBrandDefault: p.id === input.defaultPersonaId,
  }));

  const defaultCard = personaCards.find(c => c.isBrandDefault) ?? null;
  const rest = personaCards.filter(c => !c.isBrandDefault);

  const rated = rest.filter(c => c.hitRate.rate !== null);
  const unrated = rest.filter(c => c.hitRate.rate === null);

  rated.sort((a, b) => {
    const byRate = (b.hitRate.rate ?? 0) - (a.hitRate.rate ?? 0);
    if (byRate !== 0) return byRate;
    const byN = b.hitRate.n - a.hitRate.n;
    if (byN !== 0) return byN;
    return a.name.localeCompare(b.name);
  });
  unrated.sort((a, b) => a.name.localeCompare(b.name));

  const ordered = [...(defaultCard ? [defaultCard] : []), ...rated, ...unrated];

  const house: SpreadCard = {
    id: HOUSE_STYLE_ID,
    kind: "house",
    name: "House style",
    description:
      "The brand's own look, with no director on top. The baseline every other card is a departure from.",
    governs: ["Composition", "Typography", "Colour treatment"],
    referenceCount: 0,
    hitRate: computeHitRate(byPersona.get(HOUSE_STYLE_ID) ?? []),
    isBrandDefault: input.defaultPersonaId === null,
  };

  const at = Math.min(HOUSE_STYLE_INDEX, ordered.length);
  return [...ordered.slice(0, at), house, ...ordered.slice(at)];
}
