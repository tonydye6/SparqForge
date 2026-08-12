/**
 * Assertions for the cut's status and its fingerprint.
 *
 * The ones that matter are the edits a naive staleness check MISSES — a
 * reorder, a trim, a level nudge, a second SFX — because each of them changes
 * the file and none of them changes a timestamp on the sequence row.
 */
import {
  computeCutFingerprint,
  cutStatus,
  describeSound,
  type CutClip,
  type CutTrack,
} from "./cut-status.js";

const clip = (over: Partial<CutClip> & { id: string; position: number }): CutClip => ({
  trimStartMs: 0,
  trimEndMs: 3000,
  transitionIn: "cut",
  sourceKind: "studio_take",
  sourceTakeId: `take-${over.id}`,
  ...over,
});

const track = (over: Partial<CutTrack> & { id: string }): CutTrack => ({
  trackKind: "music",
  audioUrl: "/api/files/generated/a.mp3",
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

  const a = clip({ id: "a", position: 0 });
  const b = clip({ id: "b", position: 1 });
  const base = computeCutFingerprint([a, b], []);

  // ---- the fingerprint ----
  check("the same cut fingerprints the same", computeCutFingerprint([a, b], []) === base);
  check(
    "row order does not matter, position does",
    computeCutFingerprint([b, a], []) === base,
  );
  check(
    "a REORDER changes it",
    computeCutFingerprint([{ ...a, position: 1 }, { ...b, position: 0 }], []) !== base,
  );
  check(
    "a TRIM changes it",
    computeCutFingerprint([{ ...a, trimEndMs: 2000 }, b], []) !== base,
  );
  check(
    "a TRANSITION changes it",
    computeCutFingerprint([a, { ...b, transitionIn: "dissolve" }], []) !== base,
  );
  check(
    "swapping the take a shot points at changes it",
    computeCutFingerprint([{ ...a, sourceTakeId: "take-other" }, b], []) !== base,
  );
  check(
    "losing a shot's source changes it",
    computeCutFingerprint([{ ...a, sourceMissingAt: new Date() }, b], []) !== base,
  );
  check("adding a shot changes it", computeCutFingerprint([a, b, clip({ id: "c", position: 2 })], []) !== base);
  check("removing a shot changes it", computeCutFingerprint([a], []) !== base);

  {
    const music = track({ id: "m1" });
    const withMusic = computeCutFingerprint([a, b], [music]);
    check("adding a track changes it", withMusic !== base);
    check(
      "track row order does not matter",
      computeCutFingerprint([a, b], [music, track({ id: "m2", trackKind: "sfx" })])
        === computeCutFingerprint([a, b], [track({ id: "m2", trackKind: "sfx" }), music]),
    );
    check(
      "a GAIN nudge changes it — the mix, and therefore the file, is different",
      computeCutFingerprint([a, b], [{ ...music, gainDb: -6 }]) !== withMusic,
    );
    check(
      "a DUCK change changes it",
      computeCutFingerprint([a, b], [{ ...music, duckAmountDb: -20 }]) !== withMusic,
    );
    check(
      "moving a hit changes it",
      computeCutFingerprint([a, b], [{ ...music, startMs: 1200 }]) !== withMusic,
    );
    check(
      "re-generating a track changes it — same shape, new file",
      computeCutFingerprint([a, b], [{ ...music, audioUrl: "/api/files/generated/b.mp3" }]) !== withMusic,
    );
  }

  // ---- the sound sentence ----
  check("no tracks says nothing", describeSound([]) === "");
  check(
    "one of each reads plainly",
    describeSound([track({ id: "1", trackKind: "voice" }), track({ id: "2", trackKind: "music" })])
      === "voice + music",
    describeSound([track({ id: "1", trackKind: "voice" }), track({ id: "2", trackKind: "music" })]),
  );
  {
    const s = describeSound([
      track({ id: "1", trackKind: "voice" }),
      track({ id: "2", trackKind: "music" }),
      track({ id: "3", trackKind: "sfx" }),
      track({ id: "4", trackKind: "sfx" }),
    ]);
    check("hits are counted", s === "voice + music + 2 SFX", s);
  }

  // ---- the states ----
  const status = (over: Partial<Parameters<typeof cutStatus>[0]> = {}) => cutStatus({
    renderStatus: "draft",
    renderedUrl: null,
    renderFingerprint: null,
    clips: [a, b],
    tracks: [],
    renderable: true,
    totalDurationMs: 6000,
    ...over,
  });

  {
    const s = status({ clips: [] });
    check("an empty cut is empty and blocked", s.state === "empty" && s.blocked !== null, s);
  }
  {
    const s = status();
    check("shots with no render read unrendered", s.state === "unrendered", s);
    check("and the summary counts them", s.summary.startsWith("2 shots · 6.0s"), s.summary);
    check("and nothing blocks it", s.blocked === null, s);
  }
  {
    const s = status({ renderable: false });
    check("a missing source BLOCKS rather than warns", s.blocked !== null, s);
  }
  {
    const s = status({ renderStatus: "rendering" });
    check("a render in flight blocks a second one", s.state === "rendering" && s.blocked !== null, s);
  }
  {
    const s = status({
      renderStatus: "rendered",
      renderedUrl: "/api/files/generated/cut.mp4",
      renderFingerprint: base,
    });
    check("a matching fingerprint reads rendered", s.state === "rendered", s);
    check("and says it ships", s.summary.includes("ships with every channel version"), s.summary);
  }
  {
    const s = status({
      renderStatus: "rendered",
      renderedUrl: "/api/files/generated/cut.mp4",
      renderFingerprint: base,
      clips: [a, { ...b, trimEndMs: 2500 }],
    });
    check("an edit after the render reads STALE", s.state === "stale", s);
    check(
      "and the old file is still named rather than hidden — it is what shipped",
      s.renderedUrl === "/api/files/generated/cut.mp4",
      s,
    );
    check("and re-rendering is not blocked", s.blocked === null, s);
  }
  {
    /*
     * The case a timestamp check gets wrong: rendered, then the sequence rows
     * are untouched but a track was re-generated over the top.
     */
    const t = track({ id: "m1" });
    const fp = computeCutFingerprint([a, b], [t]);
    const s = status({
      renderStatus: "rendered",
      renderedUrl: "/api/files/generated/cut.mp4",
      renderFingerprint: fp,
      tracks: [{ ...t, audioUrl: "/api/files/generated/new.mp3" }],
    });
    check("a re-recorded voice stales the cut", s.state === "stale", s);
  }
  {
    const s = status({ renderStatus: "failed" });
    check("a failed render says so and stays renderable", s.state === "failed" && s.blocked === null, s);
  }
  {
    /* A render that claims success with no file is not rendered. */
    const s = status({ renderStatus: "rendered", renderedUrl: null, renderFingerprint: base });
    check("rendered with no file does not read rendered", s.state !== "rendered", s);
  }

  return results;
}
