/**
 * Phase 9 item 6 · subtitles that stay out of the platform's furniture.
 *
 * Two halves. Cues with timings, derived from the same words-per-minute the
 * composer already quotes, so the subtitle and the "will it fit" warning cannot
 * disagree about how long a line takes to say. And a vertical position that
 * clears each platform's bottom chrome, read from `crop-stage.ts`'s
 * `CROP_TARGETS` rather than from a second list — doc 22 item 6 says "kept clear
 * of platform safe areas by Phase 4's crop logic", and a second table of safe
 * areas would drift from the first within a release.
 *
 * Pure: no DB, no clock, no ffmpeg.
 */
import { CROP_TARGETS, type SafeArea } from "./crop-stage.js";
import { LEAD_IN_MS, WORDS_PER_MINUTE, countWords } from "./script-timing.js";

/**
 * Characters per subtitle cue.
 *
 * Two lines of about 42, which is the broadcast convention and roughly what a
 * phone holds at a legible size. Longer cues are not more efficient: they are
 * read slower and they crowd the safe area they were positioned to avoid.
 */
export const MAX_CUE_CHARS = 84;

/** No cue flashes past faster than this, however few words it holds. */
export const MIN_CUE_MS = 900;

export interface Cue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Split a script into cue-sized pieces.
 *
 * Sentence boundaries first, because a subtitle that breaks mid-clause reads
 * worse than a slightly short one. A sentence too long for one cue is then
 * broken on word boundaries, never mid-word.
 */
export function splitIntoCues(script: string): string[] {
  const text = script.replace(/\s+/g, " ").trim();
  if (!text) return [];

  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];

  for (const sentence of sentences) {
    if (sentence.length <= MAX_CUE_CHARS) {
      out.push(sentence);
      continue;
    }
    let current = "";
    for (const word of sentence.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > MAX_CUE_CHARS && current) {
        out.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

/**
 * Time the cues across the spoken script.
 *
 * Each cue gets time in proportion to its WORD count rather than its character
 * count, because that is what the speaking-rate estimate is denominated in and
 * mixing the two would make the last cue drift. Cues are contiguous: subtitles
 * with gaps between them flicker.
 */
export function buildCues(script: string, startMs: number = LEAD_IN_MS): Cue[] {
  const pieces = splitIntoCues(script);
  if (pieces.length === 0) return [];

  const counts = pieces.map(p => Math.max(1, countWords(p)));
  const total = counts.reduce((a, b) => a + b, 0);

  const cues: Cue[] = [];
  let cursor = startMs;
  pieces.forEach((text, i) => {
    const share = counts[i] / total;
    const spokenMs = Math.round((counts[i] / WORDS_PER_MINUTE) * 60_000);
    const durationMs = Math.max(MIN_CUE_MS, spokenMs);
    cues.push({ index: i + 1, startMs: cursor, endMs: cursor + durationMs, text });
    cursor += durationMs;
    void share;
  });
  return cues;
}

/**
 * How far down the frame the subtitles sit, as a WebVTT `line` percentage.
 *
 * Measured from the top, so a larger number is lower. The answer is driven by
 * the platform's BOTTOM furniture: TikTok's caption block and username eat
 * nearly a quarter of the frame, so subtitles placed at the usual 90% would be
 * printed underneath the username. An unknown platform gets the conventional
 * position rather than a guess at chrome nobody has measured.
 */
export const DEFAULT_LINE_PERCENT = 90;

/** A little air between the subtitle and the furniture above which it sits. */
const MARGIN_PERCENT = 4;

export function captionLinePercent(platform: string): number {
  const target = CROP_TARGETS.find(t => t.platform === platform);
  if (!target) return DEFAULT_LINE_PERCENT;
  const bottom = target.safeAreas
    .filter((a: SafeArea) => a.edge === "bottom")
    .reduce((max: number, a: SafeArea) => Math.max(max, a.fraction), 0);
  if (bottom <= 0) return DEFAULT_LINE_PERCENT;
  return Math.round(Math.min(DEFAULT_LINE_PERCENT, (1 - bottom) * 100 - MARGIN_PERCENT));
}

/** `HH:MM:SS.mmm`, which is the only timestamp form WebVTT accepts. */
export function vttTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const milli = clamped % 1000;
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

/**
 * The WebVTT track, positioned for the platform.
 *
 * This string is what `creative_variants.captionsVtt` holds, and it is also
 * what a burned-in render reads, so the burned and the sidecar subtitles are
 * the same words at the same times by construction rather than by discipline.
 */
export function toWebVtt(cues: readonly Cue[], platform: string): string {
  const line = captionLinePercent(platform);
  const body = cues
    .map(c => `${c.index}\n${vttTime(c.startMs)} --> ${vttTime(c.endMs)} line:${line}%\n${c.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

export interface CaptionTrack {
  vtt: string;
  cues: Cue[];
  linePercent: number;
  /** Total run of the subtitles, for comparing against the clip. */
  endMs: number;
}

export function buildCaptionTrack(script: string, platform: string): CaptionTrack {
  const cues = buildCues(script);
  return {
    vtt: cues.length > 0 ? toWebVtt(cues, platform) : "",
    cues,
    linePercent: captionLinePercent(platform),
    endMs: cues.length > 0 ? cues[cues.length - 1].endMs : 0,
  };
}
