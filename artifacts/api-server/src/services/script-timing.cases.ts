/**
 * Assertions for script timing.
 *
 * The estimate is free and the render is not, so the cases that matter are the
 * boundaries: the script that just fits, the one that just does not, and the
 * one that fits on paper and will still sound rushed.
 */
import {
  countWords,
  describeFit,
  estimateSpokenMs,
  fitScriptToClip,
  GENERATED_CLIP_MS,
  LEAD_IN_MS,
  TAIL_MS,
  TIGHT_MS,
  WORDS_PER_MINUTE,
} from "./script-timing.js";

/** n words, so a case can state a length rather than compute one. */
const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- counting the way a reader would ----
  check("plain words", countWords("the crowd goes quiet") === 4);
  check("punctuation is not a word", countWords("Ready? Set. Go!") === 3);
  check("a hyphenated compound is one word", countWords("a full-time starter") === 3);
  check("apostrophes do not split a word", countWords("it's Crown U's night") === 4);
  check("empty is zero", countWords("   \n  ") === 0);
  /*
   * Digits stay one token on purpose. "2026" is two or three spoken words
   * depending on the reader, and a rule for that would add error while looking
   * like precision.
   */
  check("a number counts once, and the doc says why", countWords("week 3 rivalry") === 3);

  // ---- the estimate ----
  check("no script, no duration", estimateSpokenMs("") === 0);
  check("one minute of words takes about a minute",
    Math.abs(estimateSpokenMs(words(WORDS_PER_MINUTE)) - 60_000) < 50,
    estimateSpokenMs(words(WORDS_PER_MINUTE)));
  check("half the words take half the time",
    Math.abs(estimateSpokenMs(words(75)) - 30_000) < 50, estimateSpokenMs(words(75)));

  // ---- fitting a 6s clip ----
  {
    const fit = fitScriptToClip(words(8));
    check("a short script fits", fit.verdict === "fits", fit);
    check("the clip length is the generated one", fit.clipMs === GENERATED_CLIP_MS, fit);
    check("required time includes the silence at both ends",
      fit.requiredMs === fit.spokenMs + LEAD_IN_MS + TAIL_MS, fit);
    check("one clip is enough", fit.clipsNeeded === 1, fit);
  }
  {
    /*
     * maxWords is the promise this makes to a writer: cut to this and it fits.
     * So a script of exactly that length must NOT come back too_long, or the
     * advice the surface gives is wrong.
     */
    const fit = fitScriptToClip(words(1));
    const atLimit = fitScriptToClip(words(fit.maxWords));
    check("a script cut to maxWords is not too long", atLimit.verdict !== "too_long", atLimit);
    check("and one word more is", fitScriptToClip(words(atLimit.maxWords + 2)).verdict === "too_long",
      fitScriptToClip(words(atLimit.maxWords + 2)));
  }
  {
    const fit = fitScriptToClip(words(60));
    check("a long script overruns", fit.verdict === "too_long", fit);
    check("headroom goes negative rather than clamping", fit.headroomMs < 0, fit);
    check("and it says how many clips it needs", fit.clipsNeeded > 1, fit);
  }
  {
    /*
     * A script cut to exactly `maxWords` fits on paper and will sound rushed,
     * so it must come back "tight" rather than as a green light. This is the
     * boundary the advice itself creates: telling a writer to cut to N words
     * and then calling N words comfortable would be the surface disagreeing
     * with its own instruction.
     */
    const limit = fitScriptToClip(words(1)).maxWords;
    const fit = fitScriptToClip(words(limit));
    check("a script cut to exactly the limit is tight, not fine",
      fit.verdict === "tight", fit);
    check("tight still means it fits", fit.headroomMs >= 0 && fit.headroomMs < TIGHT_MS, fit);
    check("the speakable window is the clip minus both silences",
      GENERATED_CLIP_MS - LEAD_IN_MS - TAIL_MS === 5350, GENERATED_CLIP_MS - LEAD_IN_MS - TAIL_MS);
  }
  {
    const fit = fitScriptToClip("");
    check("an empty script is not a failure", fit.verdict === "fits", fit);
    check("and still needs one clip", fit.clipsNeeded === 1, fit);
  }
  {
    // A clip shorter than its own silence must not produce negative maxWords.
    const fit = fitScriptToClip(words(5), 100);
    check("an impossibly short clip yields no words rather than negative ones",
      fit.maxWords === 0, fit);
  }

  // ---- what the composer says ----
  {
    check("no script says so plainly", describeFit(fitScriptToClip("")).includes("nothing to time"));
    const over = describeFit(fitScriptToClip(words(60)));
    check("an overrun names the cut and the alternative",
      over.includes("Cut to about") && over.includes("clips"), over);
    check("no em dashes in product copy",
      [describeFit(fitScriptToClip(words(8))), over].every(s => !s.includes("—")));
  }

  return results;
}
