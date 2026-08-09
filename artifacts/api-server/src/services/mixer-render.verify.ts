/**
 * Does the mixer's graph actually survive ffmpeg?
 *
 * `mixer.verify.ts` proves the graph is the one we meant to write. This proves
 * ffmpeg accepts it, which is a different question and the one that bites: a
 * filter string can be perfectly well formed and still be rejected for a label
 * that does not exist or a stream specifier off by one.
 *
 * Synthesises its own inputs, so it needs no fixtures and costs nothing. It
 * DOES need ffmpeg on PATH, which the Replit container has and a Mac generally
 * does not.
 *
 * Run: pnpm exec tsx src/services/mixer-render.verify.ts   (from artifacts/api-server)
 */
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { renderMix } from "./audio-merge.js";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    console.log("\nffmpeg is not on PATH, so the render cannot be checked here. Run this on Replit.\n");
    process.exit(2);
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sparqmake-mixcheck-"));
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    if (ok) console.log(`  ok    ${name}`);
    else {
      console.log(`  FAIL  ${name}${detail === undefined ? "" : ` · ${JSON.stringify(detail)}`}`);
      failures.push(name);
    }
  };

  try {
    // A 6s silent black clip, which is the shape a generated clip really is.
    const videoPath = path.join(dir, "v.mp4");
    await execFileAsync("ffmpeg", [
      "-f", "lavfi", "-i", "color=c=black:s=320x240:r=24:d=6",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", videoPath,
    ]);

    const tone = async (freq: number, seconds: number, file: string): Promise<Buffer> => {
      const p = path.join(dir, file);
      await execFileAsync("ffmpeg", [
        "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${seconds}`, "-y", p,
      ]);
      return fs.promises.readFile(p);
    };

    const music = await tone(220, 6, "music.mp3");
    const voice = await tone(880, 2, "voice.mp3");

    const result = await renderMix({
      videoBuffer: await fs.promises.readFile(videoPath),
      tracks: [
        {
          id: "music", trackKind: "music", startMs: 0, durationMs: 6000,
          gainDb: -6, duckUnder: "voice", duckAmountDb: -12,
          audioBuffer: music, mimeType: "audio/mpeg",
        },
        {
          id: "voice", trackKind: "voice", startMs: 1000, durationMs: 2000,
          gainDb: 0, audioBuffer: voice, mimeType: "audio/mpeg",
        },
      ],
    });

    console.log("\nmixer render check\n");
    check("ffmpeg accepted the graph", result.videoBuffer.length > 0);
    check("the duck made it into the command",
      result.filterComplex.includes("enable='between(t,1.000,3.000)'"), result.filterComplex);
    check("stream specifiers were shifted past the video",
      result.filterComplex.includes("[1:a]") && result.filterComplex.includes("[2:a]")
      && !result.filterComplex.includes("[0:a]"), result.filterComplex);
    check("nothing was silently skipped", result.warnings.length === 0, result.warnings);

    const outPath = path.join(dir, "out.mp4");
    await fs.promises.writeFile(outPath, result.videoBuffer);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_type", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1", outPath,
    ]);
    check("the result has a video stream", stdout.includes("codec_type=video"), stdout);
    check("and an audio stream", stdout.includes("codec_type=audio"), stdout);
    const duration = Number(/duration=([\d.]+)/.exec(stdout)?.[1] ?? 0);
    check("and is still the length of the clip, not the longest track",
      duration > 5.5 && duration < 6.6, duration);

    console.log(`\n${failures.length === 0 ? "all checks pass" : `${failures.length} failed`}\n`);
    process.exit(failures.length === 0 ? 0 : 1);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

await main();
