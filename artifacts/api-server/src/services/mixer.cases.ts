/**
 * Assertions for the mixer.
 *
 * The ones that matter are about things you would otherwise only find by
 * listening: the normalize flag that silently undoes every gain, the gap
 * between two ducks that makes automated ducking sound automated, and the duck
 * that never happened because the track it was waiting on had no length.
 */
import {
  buildMixPlan,
  dbToLinear,
  describeMix,
  duckWindowsFor,
  mergeWindows,
  DEFAULT_DUCK_DB,
  type MixTrack,
} from "./mixer.js";

const track = (over: Partial<MixTrack> & { id: string }): MixTrack => ({
  trackKind: "music",
  startMs: 0,
  durationMs: 6000,
  gainDb: 0,
  ...over,
});

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- decibels ----
  check("0 dB is unity", dbToLinear(0) === 1);
  check("-6 dB is about half the amplitude", Math.abs(dbToLinear(-6) - 0.501) < 0.002, dbToLinear(-6));
  check("-12 dB is about a quarter", Math.abs(dbToLinear(-12) - 0.251) < 0.002, dbToLinear(-12));
  check("+6 dB is louder, not quieter", dbToLinear(6) > 1);

  // ---- windows ----
  {
    const merged = mergeWindows([{ startMs: 0, endMs: 1000 }, { startMs: 900, endMs: 2000 }]);
    check("overlapping windows become one", merged.length === 1, merged);
    check("and it spans both", merged[0]?.startMs === 0 && merged[0]?.endMs === 2000, merged);
  }
  {
    /*
     * Touching, not overlapping. Two voice lines back to back would otherwise
     * duck twice with a full-volume bump between them, which is exactly the
     * artefact that makes automated ducking audible as automation.
     */
    const merged = mergeWindows([{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2000 }]);
    check("touching windows also become one", merged.length === 1, merged);
  }
  {
    const merged = mergeWindows([{ startMs: 3000, endMs: 4000 }, { startMs: 0, endMs: 1000 }]);
    check("windows come back in order", merged[0]?.startMs === 0, merged);
    check("and a real gap is preserved", merged.length === 2, merged);
  }
  check("a zero-length window is not a window",
    mergeWindows([{ startMs: 100, endMs: 100 }]).length === 0);

  // ---- what ducks under what ----
  {
    const music = track({ id: "m", trackKind: "music", duckUnder: "voice" });
    const voice = track({ id: "v", trackKind: "voice", startMs: 1000, durationMs: 2500 });
    const w: string[] = [];
    const windows = duckWindowsFor(music, [music, voice], w);
    check("music ducks across the voice", windows.length === 1, windows);
    check("over exactly the voice's span",
      windows[0]?.startMs === 1000 && windows[0]?.endMs === 3500, windows);
    check("and says nothing it does not need to", w.length === 0, w);
  }
  {
    // Set to duck, but there is nothing to duck under. Say so.
    const music = track({ id: "m", trackKind: "music", duckUnder: "voice" });
    const w: string[] = [];
    const windows = duckWindowsFor(music, [music], w);
    check("no voice means no duck", windows.length === 0, windows);
    check("and the silence is explained", w.length === 1 && w[0].includes("no voice track"), w);
  }
  {
    /*
     * The voice has not rendered yet, so its length is unknown. Guessing would
     * duck the bed for a made-up span; the honest answer is to say why it did
     * not happen.
     */
    const music = track({ id: "m", trackKind: "music", duckUnder: "voice" });
    const voice = track({ id: "v", trackKind: "voice", durationMs: null });
    const w: string[] = [];
    check("a voice of unknown length cannot duck anything",
      duckWindowsFor(music, [music, voice], w).length === 0);
    check("and it says which track to render first",
      w.length === 1 && w[0].includes("Render the voice first"), w);
  }
  {
    // Two voice lines: one merged duck if they touch, two if they do not.
    const music = track({ id: "m", trackKind: "music", duckUnder: "voice" });
    const v1 = track({ id: "v1", trackKind: "voice", startMs: 0, durationMs: 1000 });
    const v2 = track({ id: "v2", trackKind: "voice", startMs: 4000, durationMs: 1000 });
    const windows = duckWindowsFor(music, [music, v1, v2], []);
    check("two separated voice lines duck twice", windows.length === 2, windows);
  }
  {
    const voice = track({ id: "v", trackKind: "voice", duckUnder: "voice" });
    check("a track never ducks under itself",
      duckWindowsFor(voice, [voice], []).length === 0);
  }

  // ---- the graph ----
  {
    const music = track({ id: "m", trackKind: "music", gainDb: -6, duckUnder: "voice" });
    const voice = track({ id: "v", trackKind: "voice", startMs: 500, durationMs: 2000, gainDb: 0 });
    const plan = buildMixPlan([music, voice]);

    check("every track gets an input index", plan.tracks.map(t => t.inputIndex).join() === "0,1", plan.tracks);
    check("the music chain carries its gain", plan.tracks[0].filter.includes("volume=0.501"), plan.tracks[0]);
    check("and its duck", plan.tracks[0].filter.includes("enable='between(t,0.500,2.500)'"), plan.tracks[0]);
    check("the delayed voice is delayed", plan.tracks[1].filter.includes("adelay=500|500"), plan.tracks[1]);

    /*
     * THE ONE THAT MATTERS MOST. amix normalizes by input count by default,
     * which divides every level and quietly undoes the per-track gain this
     * whole file exists to provide. Adding a third track would make the first
     * two quieter for no visible reason.
     */
    check("amix does not normalize", plan.filterComplex.includes("normalize=0"), plan.filterComplex);
    check("and runs to the longest track", plan.filterComplex.includes("duration=longest"));
    check("the output is labelled for -map", plan.outputLabel === "mixout");
    check("the graph ends in that label", plan.filterComplex.endsWith("[mixout]"), plan.filterComplex);
    check("input count matches the tracks", plan.filterComplex.includes("amix=inputs=2"));
  }
  {
    // A track needing nothing still needs a node, or its label does not exist.
    const plan = buildMixPlan([track({ id: "a", gainDb: 0, startMs: 0 })]);
    check("an untouched track still gets a node", plan.tracks[0].filter.includes("anull"), plan.tracks[0]);
    check("and a label the mix can reference",
      plan.filterComplex.includes("[m0]amix"), plan.filterComplex);
  }
  {
    const plan = buildMixPlan([]);
    check("no tracks, no graph", plan.filterComplex === "" && plan.tracks.length === 0);
    check("and nothing to map", plan.outputLabel === "");
  }
  {
    // Explicit 0 dB duck means "do not duck", and must not emit a filter.
    const music = track({ id: "m", trackKind: "music", duckUnder: "voice", duckAmountDb: 0 });
    const voice = track({ id: "v", trackKind: "voice", durationMs: 1000 });
    const plan = buildMixPlan([music, voice]);
    check("a zero-dB duck writes no duck filter",
      !plan.tracks[0].filter.includes("enable="), plan.tracks[0]);
  }
  check("the documented default duck is -12 dB", DEFAULT_DUCK_DB === -12);

  // ---- what the strip says ----
  {
    check("nothing to mix says so", describeMix(buildMixPlan([])).includes("nothing to mix"));
    const music = track({ id: "m", trackKind: "music", duckUnder: "voice" });
    const voice = track({ id: "v", trackKind: "voice", durationMs: 1000 });
    const line = describeMix(buildMixPlan([music, voice]));
    check("a ducked mix explains itself", line.includes("so the voice stays clear"), line);
    check("no em dashes in product copy", !line.includes("—"), line);
  }

  return results;
}
