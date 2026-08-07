/**
 * Find third-party trademarks baked into a brand's source assets.
 *
 * Run ON REPLIT (needs the live database and GEMINI_API_KEY):
 *
 *   cd artifacts/api-server && pnpm exec tsx scripts/scan-trademarks.ts --brand "Crown U"
 *
 * Why this is a script and not a prompt tweak: on 2026-08-07 three separate
 * Crown U renders came back carrying a Nike swoosh and a B1G mark, on a brand
 * whose negativePrompt already forbids non-Crown-U logos. The marks were in the
 * character reference itself, and the identity lock exists to reproduce that
 * reference exactly. Prompting cannot win an argument with itself, so the check
 * has to happen at the asset.
 *
 * READS ONLY BY DEFAULT. It prints a report and changes nothing. Pass --flag to
 * set generationAllowed=false on the assets it judges blocked, which is the
 * gate asset-policy already honours for the generation-reference role. That
 * write is opt-in because blocking the only character asset a brand owns takes
 * its whole studio offline, and that is a decision with a person behind it.
 *
 * Cost: one gemini-3.5-flash vision call per image asset. Use --limit while
 * exploring. --dry-run skips the model entirely and still lists what would be
 * scanned, which costs nothing.
 *
 * Files are fetched THROUGH the running api-server rather than read off disk.
 * A first version read disk directly and skipped 41 of 52 Crown U assets as
 * "not readable", because most media is bucket-backed. The server already knows
 * how to resolve either, so ask it.
 *
 * Flags:
 *   --brand <name|id>   default "Crown U" (name match is case-insensitive)
 *   --name <substr>     only assets whose name contains this (case-insensitive)
 *   --limit <n>         scan at most n assets, newest first
 *   --flag              WRITE generationAllowed=false on blocked assets
 *   --dry-run           list the assets and exit without calling the model
 *   --all               include assets already blocked from generation
 *   --server <url>      api-server base, default http://localhost:$PORT (or 5000)
 *   --licensed <kinds>  comma-separated mark kinds this brand has a licence
 *                       for, e.g. --licensed conference,university. They are
 *                       still reported, but stop driving severity. Confirmed
 *                       for Crown U on 2026-08-07.
 */

import { db, assetsTable, brandsTable } from "@workspace/db";
import type { Asset, Brand } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { COPILOT_MODELS } from "../src/lib/ai-config.js";
import { extractJSON } from "../src/lib/extract-json.js";
import {
  TRADEMARK_RESPONSE_SCHEMA,
  buildTrademarkSystemPrompt,
  parseTrademarkFindings,
  assessAsset,
  formatScanRow,
  type ScanAssessment,
  type MarkKind,
} from "../src/services/trademark-scan.js";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) return process.argv[i + 1]!;
  const inline = process.argv.find(a => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : null;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
function rule(title: string): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

async function resolveBrand(needle: string): Promise<Brand> {
  const [byId] = await db.select().from(brandsTable).where(eq(brandsTable.id, needle));
  if (byId) return byId;
  const all = await db.select().from(brandsTable);
  const hit = all.find(b => b.name.toLowerCase() === needle.toLowerCase())
    ?? all.find(b => b.name.toLowerCase().includes(needle.toLowerCase()));
  if (!hit) throw new Error(`No brand matching "${needle}". Have: ${all.map(b => b.name).join(", ")}`);
  return hit;
}

/**
 * What counts as this brand's OWN marks, so the scan never reports them.
 * Built from the brand name plus every logo-ish asset it owns, because a model
 * told only "Crown U" will still cheerfully report "Crown U crown logo".
 */
function ownMarksFor(brand: Brand, assets: readonly Asset[]): string[] {
  const marks = new Set<string>([brand.name, "Sparq", "Sparq Games", "SPARQ"]);
  for (const a of assets) {
    const name = String(a.name ?? "");
    if (/logo|mark|wordmark|crest|badge/i.test(name) || a.assetClass === "compositing") {
      marks.add(name.replace(/\.(png|jpe?g|svg|webp)$/i, "").replace(/[_-]+/g, " ").trim());
    }
  }
  return [...marks].filter(m => m.length > 1).slice(0, 24);
}

/** Local disk path, tried first because it costs nothing when it works. */
function localPathFor(fileUrl: string): string | null {
  const m = /\/api\/files\/(?:([\w-]+)\/)?(.+)$/.exec(fileUrl);
  if (!m) return null;
  const bucket = m[1] ?? "";
  const name = m[2]!;
  const root = process.env.FILE_STORAGE_DIR ?? path.resolve(process.cwd(), "uploads");
  return bucket ? path.join(root, bucket, name) : path.join(root, name);
}

const SERVER = (arg("server") ?? `http://localhost:${process.env.PORT ?? 5000}`).replace(/\/$/, "");

/**
 * Disk first, then the running server. Most media is bucket-backed, and the
 * server is the only thing that knows how to resolve both.
 */
async function loadAssetBytes(fileUrl: string): Promise<Buffer | null> {
  const p = localPathFor(fileUrl);
  if (p) {
    try { return await readFile(p); } catch { /* fall through to HTTP */ }
  }
  if (!fileUrl.startsWith("/")) return null;
  try {
    const res = await fetch(`${SERVER}${fileUrl}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function scanOne(
  asset: Asset,
  ownMarks: readonly string[],
  brandName: string,
  licensedKinds: readonly MarkKind[],
): Promise<ScanAssessment | null> {
  const fileUrl = String(asset.fileUrl ?? "");
  const buf = await loadAssetBytes(fileUrl);
  if (!buf) return null;

  const response = await geminiAi.models.generateContent({
    model: COPILOT_MODELS.ART_DIRECTION_MODEL,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { data: buf.toString("base64"), mimeType: String(asset.mimeType ?? "image/png") } },
        { text: `Check this asset ("${asset.name}") for trademarks owned by someone other than ${brandName}.` },
      ],
    }],
    config: {
      systemInstruction: buildTrademarkSystemPrompt(brandName, ownMarks),
      // A thinking model spends reasoning tokens against this budget.
      maxOutputTokens: 4096,
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: TRADEMARK_RESPONSE_SCHEMA,
    },
  });

  const { findings, rejected } = parseTrademarkFindings(extractJSON<unknown>(response.text ?? ""), ownMarks);
  if (rejected.length > 0 && process.env.VERBOSE) {
    console.log(`        (dropped: ${rejected.map(r => `${r.mark} — ${r.reason}`).join("; ")})`);
  }
  return assessAsset(findings, { licensedKinds });
}

async function main(): Promise<void> {
  const brand = await resolveBrand(arg("brand") ?? "Crown U");
  const limit = Number(arg("limit") ?? "0") || 0;
  const willWrite = flag("flag");
  const dryRun = flag("dry-run");

  const where = flag("all")
    ? and(eq(assetsTable.brandId, brand.id), ne(assetsTable.status, "archived"))
    : and(eq(assetsTable.brandId, brand.id), ne(assetsTable.status, "archived"), ne(assetsTable.generationAllowed, false));

  let assets = await db.select().from(assetsTable).where(where);
  assets = assets.filter(a => String(a.mimeType ?? "").startsWith("image/"));
  // Narrow to one asset, or one family, when you already suspect something.
  // A library of 268 images is a long scan to sit through to answer a question
  // about exactly one of them.
  const needle = (arg("name") ?? "").trim().toLowerCase();
  if (needle) assets = assets.filter(a => String(a.name ?? "").toLowerCase().includes(needle));
  assets.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  if (limit > 0) assets = assets.slice(0, limit);

  rule(`TRADEMARK SCAN · ${brand.name} · ${assets.length} image asset${assets.length === 1 ? "" : "s"}${needle ? ` matching "${needle}"` : ""}`);
  if (assets.length === 0) {
    console.log(`  Nothing matched. Widen --name, or drop it to scan the whole library.\n`);
    return;
  }
  console.log(willWrite ? "  MODE: report AND flag blocked assets (generationAllowed=false)" : "  MODE: report only, nothing is written");
  if (dryRun) {
    for (const a of assets) console.log(`  would scan  ${a.name}`);
    console.log(`\n  --dry-run: no model calls, nothing spent.\n`);
    return;
  }

  const licensedKinds = (arg("licensed") ?? "")
    .split(",").map(k => k.trim()).filter(Boolean) as MarkKind[];
  if (licensedKinds.length > 0) {
    console.log(`  Licensed for this brand (reported, but not treated as problems): ${licensedKinds.join(", ")}`);
  }
  const ownMarks = ownMarksFor(brand, assets);
  console.log(`  Own marks excluded from reporting: ${ownMarks.slice(0, 8).join(", ")}${ownMarks.length > 8 ? ` … +${ownMarks.length - 8}` : ""}`);

  const blocked: Array<{ asset: Asset; a: ScanAssessment }> = [];
  const review: Array<{ asset: Asset; a: ScanAssessment }> = [];
  let clear = 0, unreadable = 0;

  rule("PER ASSET");
  for (const asset of assets) {
    let a: ScanAssessment | null = null;
    try {
      a = await scanOne(asset, ownMarks, brand.name, licensedKinds);
    } catch (err) {
      console.log(`  ERROR    ${String(asset.name).slice(0, 52)}  ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!a) { unreadable++; console.log(`  skipped  ${String(asset.name).slice(0, 52)}  (file not readable from disk or the server)`); continue; }
    console.log(formatScanRow(String(asset.name), a));
    if (a.severity === "blocked") blocked.push({ asset, a });
    else if (a.severity === "review") review.push({ asset, a });
    else clear++;
  }

  rule("SUMMARY");
  console.log(`  clear      ${clear}`);
  console.log(`  review     ${review.length}`);
  console.log(`  BLOCKED    ${blocked.length}`);
  if (unreadable > 0) console.log(`  unreadable ${unreadable}  (is the api-server running? try --server <url>)`);

  for (const { asset, a } of blocked) {
    console.log(`\n  ${asset.name}\n    ${a.reason}`);
  }

  if (blocked.length > 0 && willWrite) {
    for (const { asset } of blocked) {
      await db.update(assetsTable)
        .set({ generationAllowed: false, updatedAt: new Date() })
        .where(eq(assetsTable.id, asset.id));
    }
    console.log(`\n  Wrote generationAllowed=false on ${blocked.length} asset${blocked.length === 1 ? "" : "s"}.`);
    console.log(`  They can no longer be used as generation references. Re-enable in Asset Details after retouching.`);
  } else if (blocked.length > 0) {
    console.log(`\n  Nothing was written. Re-run with --flag to block these, or clean the artwork and rescan.`);
  }
  console.log("");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
