/**
 * Re-scan a brand's library for third-party trademarks, WITHOUT needing the
 * database.
 *
 * `scan-trademarks.ts` is the real tool and should be preferred — it reads the
 * library from the DB and can write verdicts back. This variant exists because
 * the scanner's 46-image finding from August was never persisted, and recovering
 * it needed a run that could happen before M3 (0031) reached the live database:
 *
 *   - asset list  → the dev preview API (`/api/assets`), not drizzle
 *   - image bytes → the dev preview API (`/api/files/...`)
 *   - verdicts    → a JSON file, not an UPDATE
 *
 * So the paid output survives regardless of migration state, and applying it is
 * a separate, free, reviewable step. This is the whole reason to decouple: the
 * expensive part is the vision assessments, and they must not be hostage to
 * whether a schema change has landed yet.
 *
 * DEDUPES BY CONTENT HASH BEFORE SPENDING. The library carries many rows that
 * are byte-identical files under different (sometimes contradictory) names — one
 * image appears three times labelled both "soccer" and "basketball". Scanning
 * per-row would pay several times for one picture and produce verdicts that can
 * disagree with each other about the same pixels.
 *
 * Run (from artifacts/api-server):
 *   GEMINI_API_KEY=... pnpm exec tsx scripts/rescan-trademarks-standalone.ts \
 *     --server https://<dev-domain> --brand "Crown U" --out /tmp/rescan.json
 *
 * Flags:
 *   --server <url>    dev preview base (an Origin header is sent; CSRF needs it)
 *   --brand <name>    default "Crown U"
 *   --out <path>      where to write the result set (required)
 *   --limit <n>       scan at most n unique images (for a costed probe first)
 *   --name <substr>   scan only assets whose name contains this, case-insensitive;
 *                     the way to settle ONE image without paying for the library
 *   --licensed <k,k>  mark kinds this brand licenses; default conference,university
 *   --model <id>      default gemini-3.5-flash
 *   --dry-run         list what would be scanned, spend nothing
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  assessAsset,
  buildTrademarkSystemPrompt,
  parseTrademarkFindings,
  TRADEMARK_RESPONSE_SCHEMA,
  type MarkKind,
  type ScanAssessment,
} from "../src/services/trademark-scan.js";

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) return process.argv[i + 1]!;
  return process.argv.find(a => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
};
const has = (n: string): boolean => process.argv.includes(`--${n}`);

const SERVER = (arg("server") ?? "").replace(/\/$/, "");
const BRAND = arg("brand") ?? "Crown U";
const OUT = arg("out");
const LIMIT = arg("limit") ? Number(arg("limit")) : undefined;
const NAME = arg("name");
const MODEL = arg("model") ?? "gemini-3.5-flash";
const DRY = has("dry-run");
const LICENSED = (arg("licensed") ?? "conference,university")
  .split(",").map(s => s.trim()).filter(Boolean) as MarkKind[];

const KEY = process.env.GEMINI_API_KEY;
if (!SERVER || !OUT) { console.error("need --server and --out"); process.exit(1); }
if (!KEY && !DRY) { console.error("need GEMINI_API_KEY (or --dry-run)"); process.exit(1); }

/** gemini-3.5-flash, $1.50/M in and $9.00/M out — for an honest running total. */
const IN_PER_TOKEN = 1.5 / 1_000_000;
const OUT_PER_TOKEN = 9.0 / 1_000_000;

async function api<T>(path: string): Promise<T> {
  const r = await fetch(SERVER + path, { headers: { Origin: SERVER } });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

interface AssetRow {
  id: string; name: string; fileUrl: string | null; mimeType: string | null;
  assetClass: string | null; status: string; generationAllowed: boolean | null;
  aiSuggestedFields: string[] | null;
}

async function main(): Promise<void> {
  const brands = await api<Array<{ id: string; name: string; trademarkRules: string | null }>>("/api/brands");
  const brand = brands.find(b => b.name.toLowerCase() === BRAND.toLowerCase());
  if (!brand) { console.error(`brand "${BRAND}" not found`); process.exit(1); }

  const rows: AssetRow[] = [];
  for (let off = 0; ; off += 200) {
    const page = await api<{ data: AssetRow[]; total: number }>(
      `/api/assets?brandId=${brand.id}&limit=200&offset=${off}`);
    rows.push(...page.data);
    if (off + 200 >= page.total) break;
  }
  /*
   * `--name` exists because a full re-scan is the wrong tool for a single
   * image. 22 of 272 images failed the first run with the API declining the
   * FILE rather than the content, and the retry fixed all but one — leaving one
   * asset with no verdict at all, which must not be allowed to read as clean.
   * Re-running 272 images to settle one is both slow and a waste of money, and
   * "just use --limit" does not work: the limit takes the first N by hash order,
   * not the one you care about.
   */
  const withFiles = rows
    .filter(r => r.fileUrl)
    .filter(r => !NAME || r.name.toLowerCase().includes(NAME.toLowerCase()));
  console.log(
    `\n${brand.name}: ${rows.length} rows, ${withFiles.length} with a file` +
      (NAME ? ` matching name ~ "${NAME}"` : ""),
  );
  if (NAME && withFiles.length === 0) {
    console.error(`no asset name contains "${NAME}" — nothing to scan`);
    process.exit(1);
  }

  /*
   * The brand's own marks must never be reported — flagging the Sparq skull
   * would recommend blocking the assets the brand exists to use. Sourced from
   * the brand record so this tracks the real trademarkRules text.
   */
  const ownMarks = [
    "the Sparq flame-skull mark",
    "the SPARQ wordmark",
    `the ${brand.name} wordmark and crown mark`,
  ];
  const system = buildTrademarkSystemPrompt(brand.name, ownMarks);

  // ---- fetch bytes and group by content hash BEFORE spending ----
  console.log("fetching bytes and grouping identical files…");
  const byHash = new Map<string, { buf: Buffer; mime: string; rows: AssetRow[] }>();
  let unreadable = 0;
  for (const r of withFiles) {
    try {
      const res = await fetch(SERVER + r.fileUrl!, { headers: { Origin: SERVER } });
      if (!res.ok) { unreadable++; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = createHash("sha256").update(buf).digest("hex");
      const mime = r.mimeType ?? res.headers.get("content-type") ?? "image/jpeg";
      const g = byHash.get(hash);
      if (g) g.rows.push(r);
      else byHash.set(hash, { buf, mime, rows: [r] });
    } catch { unreadable++; }
  }
  const groups = [...byHash.entries()];
  const dupRows = groups.reduce((n, [, g]) => n + g.rows.length - 1, 0);
  console.log(`  ${groups.length} unique images · ${dupRows} duplicate rows collapsed · ${unreadable} unreadable`);

  const todo = LIMIT ? groups.slice(0, LIMIT) : groups;
  if (DRY) {
    console.log(`\n--dry-run: would scan ${todo.length} unique images. Nothing spent.\n`);
    return;
  }

  // ---- one vision call per unique image ----
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const records: Array<{
    hash: string; assetIds: string[]; names: string[];
    assessment: ScanAssessment; rejected: Array<{ mark: string; reason: string }>;
  }> = [];
  let inTok = 0, outTok = 0, errors = 0;

  /** One model call. Separated out so a failure can be retried on a re-encode. */
  async function callModel(buf: Buffer, mime: string): Promise<{ text: string; inTok: number; outTok: number }> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [
          { inlineData: { mimeType: mime, data: buf.toString("base64") } },
          { text: "Check this image for third-party trademarks." },
        ] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: TRADEMARK_RESPONSE_SCHEMA,
          // Big budget on purpose: 3.5-flash is a THINKING model and reasoning
          // tokens count against maxOutputTokens. A small budget truncates the
          // JSON mid-object and silently degrades to a parse failure — the
          // exact trap documented for this project's structured-output calls.
          maxOutputTokens: 8192,
        },
      }),
    });
    const j = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string };
    };
    const used = {
      inTok: j.usageMetadata?.promptTokenCount ?? 0,
      outTok: j.usageMetadata?.candidatesTokenCount ?? 0,
    };
    if (j.error) throw Object.assign(new Error(j.error.message ?? "model error"), used);
    return { text: j.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "", ...used };
  }

  /**
   * Shrink before the FIRST attempt when the file is big, instead of waiting for
   * a failure to trigger the retry.
   *
   * `sparq_branded_soccer_character_female.png` is **31.8 MB**, which is ~42 MB
   * once base64-encoded into the request body. It did not come back "unable to
   * process input image" — it came back **"Deadline expired before operation
   * could complete"**, and that message does not match the retry predicate
   * below, so the re-encode that would have fixed it never ran. It was the one
   * image out of 272 with no verdict after two full runs, and the reason was
   * never the model: it was that nobody looked at the file size.
   *
   * 6 MB is comfortably under the inline-request limit while leaving every
   * normal asset (the rest of the library tops out around 4 MB) untouched, so
   * this changes nothing about what was already scanned successfully.
   */
  const INLINE_BYTES_LIMIT = 6 * 1024 * 1024;
  const shrink = (buf: Buffer): Promise<Buffer> =>
    sharp(buf)
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

  for (const [hash, g] of todo) {
    const label = g.rows[0]!.name.slice(0, 56);
    let attempt: { text: string; inTok: number; outTok: number } | null = null;
    let note = "";
    let buf = g.buf;
    let mime = g.mime;
    if (buf.length > INLINE_BYTES_LIMIT) {
      try {
        const before = buf.length;
        buf = await shrink(buf);
        mime = "image/jpeg";
        note = `  (pre-shrunk ${(before / 1e6).toFixed(1)}MB -> ${(buf.length / 1e6).toFixed(1)}MB)`;
      } catch {
        // Fall through and send the original: a failed shrink is not a reason to
        // skip the image, and the retry path below is still there.
      }
    }
    try {
      attempt = await callModel(buf, mime);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      inTok += (e as { inTok?: number }).inTok ?? 0;
      outTok += (e as { outTok?: number }).outTok ?? 0;
      /*
       * "Unable to process input image" is the API declining the FILE, not the
       * content — large or awkwardly-encoded PNGs. Re-encoding to a bounded JPEG
       * fixes it. Retrying matters more than it looks: 22 of 272 images failed on
       * the first full run, including three retouched replacements, and an
       * unscanned image that is silently dropped reads exactly like a clean one.
       * 1568px is the pre-high-res tier — small marks stay legible at it.
       */
      /*
       * `deadline expired` is in this list because of the 31.8 MB PNG above: a
       * payload big enough to time out is exactly the case re-encoding fixes,
       * and leaving it out is what let one image go two full runs with no
       * verdict at all. An unscanned image that is silently dropped reads
       * exactly like a clean one.
       */
      if (/unable to process input image|invalid image|image.*too large|deadline expired|timeout/i.test(msg)) {
        try {
          const shrunk = await shrink(g.buf);
          attempt = await callModel(shrunk, "image/jpeg");
          note = "  (retried re-encoded)";
        } catch (e2) {
          errors++;
          console.log(`  ERROR    ${label}  ${(e2 instanceof Error ? e2.message : String(e2)).slice(0, 70)}`);
          continue;
        }
      } else {
        errors++;
        console.log(`  ERROR    ${label}  ${msg.slice(0, 80)}`);
        continue;
      }
    }

    try {
      inTok += attempt.inTok; outTok += attempt.outTok;
      const { findings, rejected } = parseTrademarkFindings(JSON.parse(attempt.text), ownMarks);
      const assessment = assessAsset(findings, { licensedKinds: LICENSED });
      records.push({ hash, assetIds: g.rows.map(r => r.id), names: g.rows.map(r => r.name), assessment, rejected });
      const mark = assessment.severity === "blocked" ? "BLOCKED " : assessment.severity === "review" ? "review  " : "clear   ";
      console.log(`  ${mark} ${label}${assessment.findings.length ? "  ← " + assessment.findings.map(f => f.mark).join(", ") : ""}${note}`);
    } catch (e) {
      errors++;
      console.log(`  ERROR    ${label}  parse: ${(e instanceof Error ? e.message : String(e)).slice(0, 60)}`);
    }
  }

  const cost = inTok * IN_PER_TOKEN + outTok * OUT_PER_TOKEN;
  const blocked = records.filter(r => r.assessment.severity === "blocked");
  const review = records.filter(r => r.assessment.severity === "review");

  console.log(`\n${"=".repeat(66)}`);
  console.log(`  unique images scanned .. ${records.length}`);
  console.log(`  BLOCKED ................ ${blocked.length} images (${blocked.reduce((n, r) => n + r.assetIds.length, 0)} rows)`);
  console.log(`  review ................. ${review.length} images`);
  console.log(`  clear .................. ${records.length - blocked.length - review.length}`);
  console.log(`  errors ................. ${errors}`);
  console.log(`  tokens ................. ${inTok} in / ${outTok} out`);
  console.log(`  COST ................... $${cost.toFixed(4)}`);
  console.log(`${"=".repeat(66)}\n`);

  await writeFile(OUT!, JSON.stringify({
    brand: { id: brand.id, name: brand.name },
    model: MODEL, licensedKinds: LICENSED, ownMarks,
    scannedAt: new Date().toISOString(),
    totals: { rows: rows.length, uniqueImages: groups.length, duplicateRowsCollapsed: dupRows, unreadable, errors },
    usage: { inputTokens: inTok, outputTokens: outTok, costUsd: Number(cost.toFixed(4)) },
    records,
  }, null, 2));
  console.log(`  written: ${OUT}\n`);
}

await main();
process.exit(0);
