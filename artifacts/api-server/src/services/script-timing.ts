/**
 * Phase 9 item 5 · how long a script takes to say, and what to do when it does
 * not fit the clip.
 *
 * **Generated clips are a fixed 6 seconds** (16:9 or 9:16, verified, doc 22).
 * That is not a parameter, so a voiceover script is either short enough or the
 * clip has to grow by adding another one. Guessing at the length and finding out
 * after paying for the render is the failure this exists to prevent, and the
 * estimate is free where the render is not.
 *
 * Pure: no DB, no clock, no model call, no network. Every number here is a
 * judgement and every judgement is arguable in the assertions.
 */

/**
 * Words per minute for a brand narrator reading to camera.
 *
 * 150 is deliberately slower than conversational speech (~180) and slower than
 * an audiobook (~155). A social clip's voiceover is read against motion and
 * music, and the failure mode people actually hit is a script that is fractionally
 * too long, arriving as a rushed final word or a hard cut. Erring slow makes the
 * estimate wrong in the direction that costs nothing.
 */
export const WORDS_PER_MINUTE = 150;

/** A generated clip is exactly this long, and nothing can change it. */
export const GENERATED_CLIP_MS = 6_000;

/**
 * Silence a clip needs at each end so the voice does not begin on the first
 * frame or end on the last. Small, but it is the difference between a clip that
 * sounds produced and one that sounds clipped.
 */
export const LEAD_IN_MS = 250;
export const TAIL_MS = 400;

/**
 * Words, as a person reading aloud would count them.
 *
 * Hyphenated compounds count once because they are said as one word. Digits are
 * NOT expanded — "2026" is spoken as two or three words depending on the reader,
 * and inventing a rule for that would add error while looking like precision.
 * Callers wanting exactness should spell numbers out in the script, which is
 * what a voiceover script should do anyway.
 */
export function countWords(script: string): number {
  const cleaned = script
    .replace(/[‘’']/g, "")
    .replace(/[^\p{L}\p{N}\-]+/gu, " ")
    .trim();
  if (cleaned.length === 0) return 0;
  return cleaned.split(/\s+/).filter(w => w.replace(/-/g, "").length > 0).length;
}

/** Spoken duration of a script, before any lead-in or tail. */
export function estimateSpokenMs(script: string, wordsPerMinute = WORDS_PER_MINUTE): number {
  const words = countWords(script);
  if (words === 0) return 0;
  return Math.round((words / wordsPerMinute) * 60_000);
}

export type FitVerdict = "fits" | "tight" | "too_long";

export interface ScriptFit {
  words: number;
  spokenMs: number;
  /** Spoken duration plus the silence at both ends: what the clip must hold. */
  requiredMs: number;
  clipMs: number;
  /** Negative when the script overruns. */
  headroomMs: number;
  verdict: FitVerdict;
  /**
   * The most words that would still fit, so the offer to shorten can say BY HOW
   * MUCH rather than just "too long". A number a writer can act on beats a
   * warning they have to solve.
   */
  maxWords: number;
  /**
   * How many generated clips this script needs end to end. Always at least 1.
   * This is the "extend clip to script" answer; `maxWords` is the "fit script to
   * clip" one, and doc 22 asks for both because either can be the right call.
   */
  clipsNeeded: number;
}

/**
 * Under this much headroom the script technically fits and will still sound
 * rushed. Reported as its own verdict rather than folded into "fits", because a
 * green light that is really an amber one is how people end up re-rendering.
 */
export const TIGHT_MS = 500;

export function fitScriptToClip(script: string, clipMs = GENERATED_CLIP_MS): ScriptFit {
  const words = countWords(script);
  const spokenMs = estimateSpokenMs(script);
  const requiredMs = words === 0 ? 0 : spokenMs + LEAD_IN_MS + TAIL_MS;
  const headroomMs = clipMs - requiredMs;

  const speakableMs = Math.max(0, clipMs - LEAD_IN_MS - TAIL_MS);
  const maxWords = Math.floor((speakableMs / 60_000) * WORDS_PER_MINUTE);

  const verdict: FitVerdict =
    words === 0 || headroomMs >= TIGHT_MS ? "fits"
    : headroomMs >= 0 ? "tight"
    : "too_long";

  return {
    words,
    spokenMs,
    requiredMs,
    clipMs,
    headroomMs,
    verdict,
    maxWords,
    // The lead-in and tail are paid ONCE across the whole sequence, not per
    // clip: the silence belongs to the top and tail of the voiceover, and
    // charging it to every clip would over-count a long script into an extra
    // render nobody needs.
    clipsNeeded: words === 0 ? 1 : Math.max(1, Math.ceil(requiredMs / clipMs)),
  };
}

/**
 * The sentence the composer shows before anything is rendered.
 *
 * One place, so the screen and any later log cannot quote different numbers.
 * No em dashes: doc 22's cross-cutting rule.
 */
export function describeFit(fit: ScriptFit): string {
  const secs = (ms: number): string => (ms / 1000).toFixed(1);
  if (fit.words === 0) return "No script yet, so there is nothing to time.";
  if (fit.verdict === "fits") {
    return `About ${secs(fit.spokenMs)}s spoken, which fits the ${secs(fit.clipMs)}s clip with ` +
      `${secs(fit.headroomMs)}s to spare.`;
  }
  if (fit.verdict === "tight") {
    return `About ${secs(fit.spokenMs)}s spoken. It fits the ${secs(fit.clipMs)}s clip with only ` +
      `${secs(fit.headroomMs)}s spare, so it will sound rushed.`;
  }
  return `About ${secs(fit.spokenMs)}s spoken, which overruns the ${secs(fit.clipMs)}s clip by ` +
    `${secs(-fit.headroomMs)}s. Cut to about ${fit.maxWords} words, or extend to ` +
    `${fit.clipsNeeded} clips.`;
}
