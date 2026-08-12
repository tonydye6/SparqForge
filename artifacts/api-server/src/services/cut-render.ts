/**
 * Sequencing build step 3 · the shots become one video.
 *
 * `sequence-plan.ts` decides the order, the trims and the joins, and emits the
 * ffmpeg graph; it is pure and has never been near a file. This runs it. The
 * split is the same one the mixer already has, and for the same reason: every
 * arguable decision stays testable without ffmpeg, and this file only moves
 * bytes.
 *
 * **Sources are normalised before they are joined, and that is not optional.**
 * `concat` and `xfade` both require every input to agree on size, pixel format
 * and time base. Studio clips all come off the same model and would usually
 * agree; the moment a piece of library footage joins the cut they do not, and
 * the failure arrives from ffmpeg as a filter error naming nothing a person
 * could act on. So each shot is first re-encoded to the FIRST shot's frame —
 * shot one sets the cut's shape — and any shot that had to be reshaped says so.
 *
 * **The length is measured, never assumed.** A studio clip's stored duration is
 * estimated from its byte length, so the plan's total is an estimate of an
 * estimate. The row that says a sequence rendered has to be true about the file
 * it points at, so the finished video is probed and its REAL duration is what
 * gets written.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { PlannedClip } from "./sequence-plan.js";

const execFileAsync = promisify(execFile);

/** Generated clips are 1:1 at 24fps; a cut with no probe-able first shot falls back to this. */
const FALLBACK_GEOMETRY = { width: 1024, height: 1024 };
const TARGET_FPS = 24;

export interface ClipSource {
  /** The plan's clip, carrying position, trim and transition. */
  clip: PlannedClip;
  /** The bytes of the source video. */
  buffer: Buffer;
  /** For messages a person reads: "shot 2". */
  label: string;
}

export interface AssembleResult {
  videoBuffer: Buffer;
  /** The real, measured length of the file — not the plan's estimate. */
  measuredDurationMs: number;
  /** Things that happened to the footage on the way in, said rather than swallowed. */
  warnings: string[];
  /** The graph ffmpeg was given, for §1.17 inspectability. */
  filterComplex: string;
}

/** Whether this machine can render at all. Checked before anything is promised. */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

interface Probe {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAudio: boolean;
}

/** What a file actually is, as opposed to what a row says it is. */
export async function probe(filePath: string): Promise<Probe> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,width,height:format=duration",
      "-of", "json",
      filePath,
    ], { maxBuffer: 8 * 1024 * 1024 });
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const video = parsed.streams?.find(s => s.codec_type === "video");
    const seconds = Number.parseFloat(parsed.format?.duration ?? "");
    return {
      width: typeof video?.width === "number" ? video.width : null,
      height: typeof video?.height === "number" ? video.height : null,
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
      hasAudio: Boolean(parsed.streams?.some(s => s.codec_type === "audio")),
    };
  } catch {
    return { width: null, height: null, durationMs: null, hasAudio: false };
  }
}

/**
 * Order, trim and join the shots into one silent video.
 *
 * Silent on purpose: the sound of a cut is the audio TRACKS, which the mixer
 * lays on afterwards from rows a person can see and level. A shot that arrived
 * carrying its own audio is not silently discarded — it is reported, so
 * "where did the crowd noise go" has an answer.
 */
export async function assembleCut(params: {
  sources: readonly ClipSource[];
  /** The plan's graph. Built against the same clip order. */
  filterComplex: string;
  outputLabel: string;
}): Promise<AssembleResult> {
  const { sources, filterComplex, outputLabel } = params;
  if (sources.length === 0) throw new Error("A cut needs at least one shot.");

  const warnings: string[] = [];
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sparqmake-cut-"));

  try {
    // ---- what each source really is ----
    const rawPaths: string[] = [];
    const probes: Probe[] = [];
    for (const [i, source] of sources.entries()) {
      const p = path.join(dir, `src-${i}.mp4`);
      await fs.promises.writeFile(p, source.buffer);
      rawPaths.push(p);
      probes.push(await probe(p));
    }

    const first = probes[0];
    const width = first.width ?? FALLBACK_GEOMETRY.width;
    const height = first.height ?? FALLBACK_GEOMETRY.height;

    // ---- normalise, so the join cannot fail on a mismatch ----
    const normalisedPaths: string[] = [];
    for (const [i, source] of sources.entries()) {
      const p = probes[i];
      const out = path.join(dir, `norm-${i}.mp4`);

      if (p.hasAudio) {
        warnings.push(
          `${source.label} carries its own audio, which is not in this mix. ` +
          `Add it as a track if you want to hear it.`,
        );
      }
      if (p.width !== null && p.height !== null && (p.width !== width || p.height !== height)) {
        warnings.push(
          `${source.label} is ${p.width}×${p.height} and the cut is ${width}×${height}, ` +
          `so it was fitted inside the frame with bars rather than cropped.`,
        );
      }
      /*
       * The trim can ask for more than the file has: a studio clip's stored
       * length is estimated from its byte count, so the plan's total is an
       * estimate of an estimate. ffmpeg would quietly hand back a shorter
       * segment, which is exactly the drift between the reported duration and
       * the file that doc 21 warns about — so it is said out loud, and the
       * measured length below is what actually gets written.
       */
      if (p.durationMs !== null && source.clip.trimEndMs > p.durationMs + 100) {
        warnings.push(
          `${source.label} is ${(p.durationMs / 1000).toFixed(1)}s long but the cut asks for ` +
          `${(source.clip.trimEndMs / 1000).toFixed(1)}s of it, so it plays to its end and the cut is shorter.`,
        );
      }

      await execFileAsync("ffmpeg", [
        "-i", rawPaths[i],
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${TARGET_FPS},format=yuv420p`,
        // No audio: the cut's sound is its tracks, mixed afterwards.
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-y", out,
      ], { maxBuffer: 64 * 1024 * 1024 });
      normalisedPaths.push(out);
    }

    // ---- the plan's own graph, over the normalised inputs ----
    const assembled = path.join(dir, "assembled.mp4");
    const args: string[] = [];
    for (const p of normalisedPaths) args.push("-i", p);
    args.push(
      "-filter_complex", filterComplex,
      "-map", `[${outputLabel}]`,
      "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-y", assembled,
    );
    await execFileAsync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });

    const finished = await probe(assembled);
    if (finished.durationMs === null) {
      throw new Error("The assembled video could not be measured, so its length cannot be recorded.");
    }

    return {
      videoBuffer: await fs.promises.readFile(assembled),
      measuredDurationMs: finished.durationMs,
      warnings,
      filterComplex,
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The story path · step 4c · the last frame of a clip.
 *
 * Frame chaining, and it needs no new model: beat N+1 is seeded with the final
 * frame of beat N's clip, so the story literally begins where the previous shot
 * ended. Omni takes a first frame today, which is why this is buildable now and
 * end-frame PINNING is not (that needs Veo 3.1 — probed, doc 44 §4).
 *
 * `sseof` seeks from the end, which is the only reliable way to land on the true
 * last frame: seeking to `duration - epsilon` depends on knowing the duration
 * exactly, and a studio clip's stored duration is an estimate. Returns null
 * rather than throwing, because a chain that cannot be made should fall back to
 * the beat's own still and SAY so, not lose the animation.
 */
export async function extractLastFrame(videoBuffer: Buffer): Promise<Buffer | null> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sparqmake-lastframe-"));
  try {
    const videoPath = path.join(dir, "in.mp4");
    const framePath = path.join(dir, "last.png");
    await fs.promises.writeFile(videoPath, videoBuffer);
    await execFileAsync("ffmpeg", [
      // Read only the final second, then keep the last frame of it.
      "-sseof", "-1",
      "-i", videoPath,
      "-update", "1",
      "-frames:v", "1",
      "-y", framePath,
    ], { maxBuffer: 32 * 1024 * 1024 });
    const buf = await fs.promises.readFile(framePath);
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/** The measured length of a finished buffer, for the row that has to be true. */
export async function measureDurationMs(videoBuffer: Buffer): Promise<number | null> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sparqmake-measure-"));
  try {
    const p = path.join(dir, "v.mp4");
    await fs.promises.writeFile(p, videoBuffer);
    return (await probe(p)).durationMs;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
