/**
 * Assertions for subtitles.
 *
 * The ones that matter are the positioning cases. A subtitle printed underneath
 * TikTok's username is not a subtitle, and it is the exact failure doc 22 item 6
 * asks Phase 4's safe areas to prevent.
 */
import {
  buildCaptionTrack,
  buildCues,
  captionLinePercent,
  splitIntoCues,
  toWebVtt,
  vttTime,
  DEFAULT_LINE_PERCENT,
  MAX_CUE_CHARS,
  MIN_CUE_MS,
} from "./captions.js";

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- splitting ----
  {
    const cues = splitIntoCues("The crowd goes quiet. Then it does not.");
    check("sentences split into their own cues", cues.length === 2, cues);
    check("and keep their punctuation", cues[0] === "The crowd goes quiet.", cues);
  }
  {
    const long = `${"word ".repeat(40)}`.trim();
    const cues = splitIntoCues(long);
    check("a long sentence is broken up", cues.length > 1, cues.length);
    check("and no cue exceeds the limit",
      cues.every(c => c.length <= MAX_CUE_CHARS), cues.map(c => c.length));
    check("and no word is cut in half",
      cues.every(c => !c.startsWith("ord") && !c.endsWith("wor")), cues);
  }
  check("nothing in, nothing out", splitIntoCues("   ").length === 0);
  {
    // A single word longer than a whole cue must still come back, not vanish.
    const cues = splitIntoCues("x".repeat(MAX_CUE_CHARS + 20));
    check("an over-long single word is kept rather than dropped", cues.length === 1, cues);
  }

  // ---- timing ----
  {
    const cues = buildCues("The crowd goes quiet. Then it does not.");
    check("every cue is timed", cues.length === 2, cues);
    check("cues are contiguous, so subtitles do not flicker",
      cues[0].endMs === cues[1].startMs, cues);
    check("they start after the lead-in, not on frame one", cues[0].startMs > 0, cues[0]);
    check("each cue lasts at least the minimum",
      cues.every(c => c.endMs - c.startMs >= MIN_CUE_MS), cues);
    check("and they are numbered from one", cues[0].index === 1 && cues[1].index === 2, cues);
  }
  {
    // A longer line should hold the screen longer than a short one.
    const cues = buildCues("Go. The whole stadium is on its feet and nobody is sitting down again.");
    const first = cues[0].endMs - cues[0].startMs;
    const second = cues[1] ? cues[1].endMs - cues[1].startMs : 0;
    check("a longer line holds longer than a short one", second > first, [first, second]);
  }
  check("no script, no cues", buildCues("").length === 0);

  // ---- position, which is the point ----
  {
    /*
     * THE CASE THIS FILE EXISTS FOR. TikTok's caption block and username take
     * the bottom 24% of the frame, so the conventional 90% line would print the
     * subtitle underneath the username.
     */
    const tiktok = captionLinePercent("tiktok");
    check("TikTok subtitles clear the caption block", tiktok < DEFAULT_LINE_PERCENT, tiktok);
    check("and clear it by a real margin, not a rounding error", tiktok <= 72, tiktok);
  }
  {
    const story = captionLinePercent("instagram_story");
    check("Instagram stories clear the reply bar", story < DEFAULT_LINE_PERCENT, story);
  }
  {
    /*
     * Feed placements draw their chrome OUTSIDE the image, so there is nothing
     * to avoid and the subtitle should sit where subtitles normally sit. Moving
     * it up would be inventing a constraint.
     */
    check("a feed placement keeps the conventional position",
      captionLinePercent("instagram_feed") === DEFAULT_LINE_PERCENT);
    check("X likewise", captionLinePercent("twitter") === DEFAULT_LINE_PERCENT);
  }
  check("an unknown platform is not guessed at",
    captionLinePercent("bebo") === DEFAULT_LINE_PERCENT);

  // ---- the file itself ----
  check("timestamps are the form WebVTT accepts", vttTime(0) === "00:00:00.000");
  check("milliseconds survive", vttTime(1234) === "00:00:01.234");
  check("minutes and hours roll over", vttTime(3_723_456) === "01:02:03.456");
  check("a negative time is clamped rather than emitted", vttTime(-5) === "00:00:00.000");
  {
    const vtt = toWebVtt(buildCues("The crowd goes quiet."), "tiktok");
    check("it is a WebVTT file", vtt.startsWith("WEBVTT\n"), vtt.slice(0, 20));
    check("the cue carries an arrow", vtt.includes(" --> "), vtt);
    check("and carries the platform's line position",
      vtt.includes(`line:${captionLinePercent("tiktok")}%`), vtt);
    check("it ends with a newline, as the format wants", vtt.endsWith("\n"));
  }
  {
    const track = buildCaptionTrack("The crowd goes quiet. Then it does not.", "tiktok");
    check("the track reports where it ends", track.endMs === track.cues[1].endMs, track.endMs);
    check("and what line it sits on", track.linePercent === captionLinePercent("tiktok"));
    /*
     * The sidecar and any burned-in render read this same string, so they are
     * the same words at the same times by construction.
     */
    check("the vtt matches the cues it reports",
      track.vtt.includes(track.cues[0].text), track.vtt);
  }
  {
    const empty = buildCaptionTrack("", "tiktok");
    check("no script produces no file rather than an empty header",
      empty.vtt === "" && empty.cues.length === 0 && empty.endMs === 0, empty);
  }

  return results;
}
