import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { buildMixPlan, type MixTrack } from "./mixer.js";

const execFileAsync = promisify(execFile);

export type MergeMode = "replace" | "mix" | "mute";

export interface MergeOptions {
  videoBuffer: Buffer;
  audioBuffer?: Buffer;
  mode: MergeMode;
  audioVolume?: number;
  videoVolume?: number;
}

export async function mergeAudioVideo(options: MergeOptions): Promise<Buffer> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sparqmake-merge-"));
  const videoPath = path.join(tmpDir, "input.mp4");
  const audioPath = path.join(tmpDir, "audio.mp3");
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    await fs.promises.writeFile(videoPath, options.videoBuffer);

    if (options.mode === "mute") {
      await execFileAsync("ffmpeg", [
        "-i", videoPath,
        "-an",
        "-c:v", "copy",
        "-y",
        outputPath,
      ]);
    } else if (options.mode === "replace" && options.audioBuffer) {
      await fs.promises.writeFile(audioPath, options.audioBuffer);
      await execFileAsync("ffmpeg", [
        "-i", videoPath,
        "-i", audioPath,
        "-c:v", "copy",
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-shortest",
        "-y",
        outputPath,
      ]);
    } else if (options.mode === "mix" && options.audioBuffer) {
      await fs.promises.writeFile(audioPath, options.audioBuffer);
      const clamp = (v: number | undefined, fallback: number): number => {
        const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
        return Math.max(0, Math.min(10, n));
      };
      const vidVol = clamp(options.videoVolume, 0.3);
      const audVol = clamp(options.audioVolume, 1.0);
      await execFileAsync("ffmpeg", [
        "-i", videoPath,
        "-i", audioPath,
        "-c:v", "copy",
        "-filter_complex",
        `[0:a]volume=${vidVol}[a0];[1:a]volume=${audVol}[a1];[a0][a1]amix=inputs=2:duration=shortest[aout]`,
        "-map", "0:v:0",
        "-map", "[aout]",
        "-shortest",
        "-y",
        outputPath,
      ]);
    } else {
      await fs.promises.copyFile(videoPath, outputPath);
    }

    const result = await fs.promises.readFile(outputPath);
    return result;
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------------- *
 * Phase 9 item 3 · rendering a real mix.
 *
 * `mergeAudioVideo` above handles exactly one audio track with a linear volume,
 * which is the whole v1 model. This is the N-track one: the graph comes from
 * `mixer.ts`, which is pure and tested, and this function only moves bytes.
 * ------------------------------------------------------------------------- */

export interface MixInput extends MixTrack {
  audioBuffer: Buffer;
  /** Only used to pick a temp file extension; ffmpeg sniffs the real format. */
  mimeType?: string;
}

export interface MixResult {
  videoBuffer: Buffer;
  /** Passed through from the plan so the caller can surface what did not happen. */
  warnings: string[];
  /** The exact graph ffmpeg was given, for §1.17 inspectability. */
  filterComplex: string;
}

function extensionFor(mimeType: string | undefined): string {
  if (!mimeType) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("aac") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "mp3";
}

/**
 * Mix N audio tracks onto a video.
 *
 * **Track order is the contract.** `buildMixPlan` assigns each track an
 * `inputIndex` by position, and the ffmpeg inputs are added in that same order,
 * so the graph's `[0:a]`, `[1:a]` and the array line up. The video is input 0
 * for the file list, which is why every audio index is offset by one and the
 * plan is rebuilt against the offset list rather than patched afterwards.
 */
export async function renderMix(params: {
  videoBuffer: Buffer;
  tracks: readonly MixInput[];
  /**
   * The video's real length, in seconds. Pass it.
   *
   * **`-shortest` does not mean what the comment below used to claim.** It
   * ends the output at the shortest MAPPED STREAM, and the mapped audio is the
   * amix output — so a 6s cut carrying only a 2s voiceover came out 2s long,
   * silently throwing away four seconds of picture. Nobody would find that
   * without watching a render. With a duration, the output is held to the
   * video exactly, which is what "the video decides the length" always meant.
   */
  videoDurationSeconds?: number;
}): Promise<MixResult> {
  const { videoBuffer, tracks } = params;
  if (tracks.length === 0) {
    return { videoBuffer, warnings: ["There were no audio tracks, so the video is unchanged."], filterComplex: "" };
  }

  const plan = buildMixPlan(tracks);
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sparqmake-mix-"));
  try {
    const videoPath = path.join(tmpDir, "input.mp4");
    const outputPath = path.join(tmpDir, "output.mp4");
    await fs.promises.writeFile(videoPath, videoBuffer);

    const args: string[] = ["-i", videoPath];
    for (const [i, t] of tracks.entries()) {
      const p = path.join(tmpDir, `track-${i}.${extensionFor(t.mimeType)}`);
      await fs.promises.writeFile(p, t.audioBuffer);
      args.push("-i", p);
    }

    /*
     * The plan numbers audio inputs from 0, but ffmpeg's input 0 is the video,
     * so every audio stream reference shifts by one. Done by rewriting the
     * stream specifiers rather than by teaching the pure planner about video,
     * which would put a rendering detail inside the thing that exists to be
     * testable without one.
     */
    const shifted = plan.filterComplex.replace(/\[(\d+):a\]/g, (_m, n: string) => `[${Number(n) + 1}:a]`);

    args.push(
      "-filter_complex", shifted,
      "-map", "0:v:0",
      "-map", `[${plan.outputLabel}]`,
      "-c:v", "copy",
      /*
       * The mix runs to the longest track; the OUTPUT is held to the video, so
       * a music bed longer than the cut does not extend the post AND a short
       * voiceover cannot cut the picture off. `-shortest` only ever managed
       * the first of those — see the note on `videoDurationSeconds`.
       */
      ...(typeof params.videoDurationSeconds === "number" && params.videoDurationSeconds > 0
        ? ["-t", params.videoDurationSeconds.toFixed(3)]
        : ["-shortest"]),
      "-y", outputPath,
    );

    await execFileAsync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
    return {
      videoBuffer: await fs.promises.readFile(outputPath),
      warnings: plan.warnings,
      filterComplex: shifted,
    };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}
