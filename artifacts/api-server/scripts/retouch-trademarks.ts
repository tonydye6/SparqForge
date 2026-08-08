/**
 * Take a third-party trademark off a source asset.
 *
 * The companion to `scan-trademarks.ts`. That one finds the marks; this one
 * removes them. Run ON REPLIT, or anywhere with the live database and a real
 * `GEMINI_API_KEY`:
 *
 *   cd artifacts/api-server
 *   pnpm exec tsx scripts/retouch-trademarks.ts --name crownu_char_male_sparq_football_default
 *
 * WHY RETOUCH RATHER THAN REGENERATE OR LICENSE. These marks are hallucinated:
 * the assets are AI-rendered characters in invented SPARQ kit, so there is no
 * licence to buy — the equivalent ask is a Nike sponsorship. And regenerating
 * throws away the identity lock, which is the single most expensive thing this
 * project has bought: every character would silently become a different person
 * and stop matching anything already published. See
 * `SparqMake Sandbox/27_TRADEMARK_REMEDIATION.md`.
 *
 * NON-DESTRUCTIVE BY DEFAULT, in two separate senses.
 *  1. Without `--apply` nothing in the database changes at all. The retouched
 *     image is written to storage and its URL printed, so it can be looked at
 *     before anyone commits to it.
 *  2. Even WITH `--apply`, nothing is overwritten. A NEW asset row is created
 *     for the clean image and the original is blocked from generation through
 *     the gate the scanner already uses, linked both ways. Repointing the
 *     original's `fileUrl` was the first design and it is wrong: somebody
 *     approved that asset, and what they approved was the image with the mark
 *     in it.
 *
 * VERDICTS ARE TAKEN OVER THE SUBJECT, not the frame. A live spot removal on
 * 2026-08-07 reported 3.1% of the frame changed while the face had moved 16%
 * and the boots 25%, because the untouched background is most of the picture.
 * `measureChange` returns `subjectChangePercent` for exactly that reason.
 *
 * Cost: one image edit per asset, `COST_ESTIMATES.IMAGEN_PER_IMAGE_USD` (~$0.06).
 * One asset at a time by default, because a pass over fifty should start by
 * proving one.
 *
 * Flags:
 *   --brand <name|id>   default "Crown U"
 *   --name <substr>     the asset to retouch (case-insensitive substring)
 *   --asset <id>        or an exact asset id
 *   --limit <n>         retouch at most n assets (default 1)
 *   --apply             WRITE the new image onto the asset record
 *   --dry-run           build and print the instruction, call no model, spend nothing
 *   --licensed <kinds>  mark kinds to LEAVE in place, e.g. conference,university
 *   --server <url>      api-server base, default http://localhost:$PORT (or 8080)
 */

import { db, assetsTable, brandsTable } from "@workspace/db";
import type { Asset, Brand } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ai as geminiAi } from "@workspace/integrations-gemini-ai";
import { COPILOT_MODELS } from "../src/lib/ai-config.js";
import { extractJSON } from "../src/lib/extract-json.js";
import { writeBuffer } from "../src/services/storage.js";
import { runImageInteraction } from "../src/services/interactions-client.js";
import { measureChange } from "../src/services/region-drift.js";
import {
  TRADEMARK_RESPONSE_SCHEMA,
  buildTrademarkSystemPrompt,
  parseTrademarkFindings,
  assessAsset,
  type MarkKind,
} from "../src/services/trademark-scan.js";
import {
  buildRetouchPlan,
  formatRetouchPlan,
  retouchMessage,
  retouchVerdict,
} from "../src/services/asset-retouch.js";

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

/*
 * 8080, not 5000, and the number is not arbitrary: it is what the package's
 * own `dev` script binds (`${PORT:-8080}`). The first default was 5000, which
 * silently pointed a live run at nothing and cost a wasted vision call before
 * anyone noticed the fetch was failing rather than the file being unreadable.
 */
const SERVER = (arg("server") ?? `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/$/, "");

async function resolveBrand(needle: string): Promise<Brand> {
  const [byId] = await db.select().from(brandsTable).where(eq(brandsTable.id, needle));
  if (byId) return byId;
  const all = await db.select().from(brandsTable);
  const hit = all.find(b => b.name.toLowerCase() === needle.toLowerCase())
    ?? all.find(b => b.name.toLowerCase().includes(needle.toLowerCase()));
  if (!hit) throw new Error(`No brand matching "${needle}". Have: ${all.map(b => b.name).join(", ")}`);
  return hit;
}

/** Same two-step read as the scanner: most media is bucket-backed. */
async function loadAssetBytes(fileUrl: string): Promise<Buffer | null> {
  const m = /\/api\/files\/(?:([\w-]+)\/)?(.+)$/.exec(fileUrl);
  if (m) {
    const root = process.env.FILE_STORAGE_DIR ?? path.resolve(process.cwd(), "uploads");
    const p = m[1] ? path.join(root, m[1], m[2]!) : path.join(root, m[2]!);
    try { return await readFile(p); } catch { /* fall through */ }
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

async function scanOne(buf: Buffer, asset: Asset, ownMarks: readonly string[], brandName: string, licensed: readonly MarkKind[]) {
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
      maxOutputTokens: 4096,
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: TRADEMARK_RESPONSE_SCHEMA,
    },
  });
  const { findings } = parseTrademarkFindings(extractJSON<unknown>(response.text ?? ""), ownMarks);
  return { findings, assessment: assessAsset(findings, { licensedKinds: licensed }) };
}

async function main(): Promise<void> {
  const brand = await resolveBrand(arg("brand") ?? "Crown U");
  const willApply = flag("apply");
  const dryRun = flag("dry-run");
  const limit = Number(arg("limit") ?? "1") || 1;
  const licensed = (arg("licensed") ?? "").split(",").map(k => k.trim()).filter(Boolean) as MarkKind[];

  const all = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.brandId, brand.id), ne(assetsTable.status, "archived")));

  const exactId = arg("asset");
  const needle = (arg("name") ?? "").trim().toLowerCase();
  let targets = all.filter(a => String(a.mimeType ?? "").startsWith("image/"));
  if (exactId) targets = targets.filter(a => a.id === exactId);
  else if (needle) targets = targets.filter(a => String(a.name ?? "").toLowerCase().includes(needle));
  else {
    console.log("\n  Name an asset with --name <substring> or --asset <id>. This is a paid edit, so it does not run over a whole library by default.\n");
    return;
  }
  targets = targets.slice(0, limit);

  rule(`RETOUCH · ${brand.name} · ${targets.length} asset${targets.length === 1 ? "" : "s"}`);
  if (targets.length === 0) {
    console.log("  Nothing matched, so nothing was changed or charged.\n");
    return;
  }
  console.log(willApply
    ? "  MODE: retouch AND point the asset at the new image (the original file is kept)"
    : "  MODE: retouch and report. Nothing in the database changes.");
  if (licensed.length > 0) console.log(`  Leaving in place: ${licensed.join(", ")}`);

  const ownMarks = ownMarksFor(brand, all);

  for (const asset of targets) {
    rule(String(asset.name));

    const before = await loadAssetBytes(String(asset.fileUrl ?? ""));
    if (!before) {
      console.log("  The file could not be read from disk or the server, so nothing was charged.");
      continue;
    }

    // Rescan rather than trusting a stored verdict. The `where` field is what
    // scopes the edit, and an edit scoped by a stale location is an edit aimed
    // at the wrong part of the picture.
    const { findings } = await scanOne(before, asset, ownMarks, brand.name, licensed);
    if (findings.length === 0) {
      console.log("  No third-party marks found on this asset now. Nothing to remove.");
      continue;
    }

    const plan = buildRetouchPlan(findings, { keepKinds: licensed });
    if (!plan) {
      console.log("  Nothing here can be removed safely:");
      for (const f of findings) console.log(`    ${f.mark} @ ${f.where}`);
      console.log("  Either every mark is licensed, or the scan could not say where they are. A human should look.");
      continue;
    }

    console.log(formatRetouchPlan(String(asset.name), plan));
    console.log(`\n  INSTRUCTION SENT:\n${plan.instruction.split("\n").map(l => `    ${l}`).join("\n")}`);

    if (dryRun) {
      console.log("\n  --dry-run: no model call, nothing spent, nothing written.");
      continue;
    }

    /*
     * Deliberately NO brand style contract. Every other edit in this system
     * wraps the instruction in `buildSessionStyleContract` because it is trying
     * to make the image more like the brand; this one is trying to change as
     * little as possible, and handing the model brand visual language while
     * asking it to touch one shoe invites it to restyle the frame.
     */
    const result = await runImageInteraction({
      prompt: plan.instruction,
      slots: [{
        imageBuffer: before,
        mimeType: String(asset.mimeType ?? "image/png"),
        slot: "object",
        description: "The asset being retouched. Reproduce it exactly except where the instruction says otherwise.",
      }],
    });

    const change = await measureChange(before, result.imageBuffer);
    // The SUBJECT figure, not the global one. A character on a plain backdrop is
    // a minority of the pixels, so a whole-frame percentage flatters every
    // result: a live run read 3.1% overall while the face had moved 16%.
    const verdict = retouchVerdict(change.subjectChangePercent);

    const stem = String(asset.name ?? "asset").replace(/\.[a-z0-9]+$/i, "").slice(0, 60);
    /*
     * The extension follows the BYTES, not an assumption.
     *
     * The first version always wrote `.png` and declared `image/png`, and the
     * model returns JPEG, so every retouched asset was a JPEG wearing a PNG
     * name. This project has already paid for that once in the other direction:
     * a declared-vs-actual media-type mismatch 400'd every caption call until
     * the format was detected from the buffer instead of assumed.
     */
    const isPng = result.imageBuffer.length > 8
      && result.imageBuffer[0] === 0x89 && result.imageBuffer[1] === 0x50
      && result.imageBuffer[2] === 0x4e && result.imageBuffer[3] === 0x47;
    const ext = isPng ? "png" : "jpg";
    const outMime = isPng ? "image/png" : "image/jpeg";
    const filename = `retouch-${stem}-${Date.now()}.${ext}`;
    await writeBuffer("brand-assets", filename, result.imageBuffer);
    const afterUrl = `/api/files/brand-assets/${filename}`;

    console.log(`\n  ${retouchMessage(change.subjectChangePercent)}`);
    console.log(`  (${change.changePercent.toFixed(1)}% of the whole frame, but the frame is mostly background — judge by the subject figure.)`);
    console.log(`  before: ${asset.fileUrl}`);
    console.log(`  after:  ${afterUrl}`);
    console.log(`  Look at both before deciding. The number says how much moved, never whether the mark is gone.`);

    if (!willApply) {
      console.log(`  Nothing was written. Re-run with --apply once you have looked at it.`);
      continue;
    }
    if (verdict === "repainted" || verdict === "unchanged") {
      // Refusing to apply is not the same as refusing to produce: the image is
      // stored and its URL printed, so a human can still judge it.
      console.log(`  NOT APPLIED. --apply does not override a "${verdict}" verdict, because that is the case it exists to catch.`);
      continue;
    }

    /*
     * A NEW asset row, and the original blocked rather than overwritten.
     *
     * Repointing the original's `fileUrl` was the first design and it is wrong.
     * Somebody approved that asset, and what they approved was the image with
     * the swoosh in it; silently swapping the pixels underneath an approval
     * makes the approval mean nothing. A new row is the honest shape: the old
     * thing is retired through the gate the scanner already uses, and the new
     * thing is a new thing that a human can approve on its own terms.
     *
     * It also needs no migration. `assets` has no jsonb column to record a
     * retouch in, and inventing one to hold an audit trail is a bigger decision
     * than this pass should make on its own. The two `aiSuggestedFields`
     * markers below carry the link in both directions in a `text[]`, which is
     * what that column actually is. If retouching becomes routine, a proper
     * `retouch` jsonb column is the right follow-up.
     */
    const [created] = await db
      .insert(assetsTable)
      .values({
        brandId: asset.brandId,
        type: asset.type,
        subType: asset.subType,
        // NOT copied as approved. A retouched image is unreviewed until someone
        // reviews it, however good the change percentage looks.
        status: "uploaded",
        name: `${stem}_retouched.png`,
        description: asset.description,
        tags: asset.tags ?? [],
        fileUrl: afterUrl,
        mimeType: outMime,
        fileSizeBytes: result.imageBuffer.byteLength,
        uploadedBy: asset.uploadedBy,
        // The analysis still describes this image: only a logo left it. Copying
        // it means the clean asset is immediately as usable as the one it
        // replaces, instead of ranking last until someone re-analyses it.
        assetClass: asset.assetClass,
        generationRole: asset.generationRole,
        brandLayer: asset.brandLayer,
        franchise: asset.franchise,
        approvedChannels: asset.approvedChannels ?? [],
        approvedTemplates: asset.approvedTemplates ?? [],
        subjectIdentityScore: asset.subjectIdentityScore,
        styleStrengthScore: asset.styleStrengthScore,
        compositingOnly: asset.compositingOnly,
        generationAllowed: true,
        approvedForCompositing: asset.approvedForCompositing,
        referencePriorityDefault: asset.referencePriorityDefault,
        conflictTags: asset.conflictTags ?? [],
        characterIdentityNote: asset.characterIdentityNote,
        depictedEntities: asset.depictedEntities ?? [],
        colors: asset.colors ?? [],
        styleNotes: asset.styleNotes,
        aiSuggestedFields: [...(asset.aiSuggestedFields ?? []), `retouched_from:${asset.id}`],
      })
      .returning({ id: assetsTable.id });

    await db
      .update(assetsTable)
      .set({
        generationAllowed: false,
        aiSuggestedFields: [...(asset.aiSuggestedFields ?? []), `retouched_to:${created!.id}`],
        updatedAt: new Date(),
      })
      .where(eq(assetsTable.id, asset.id));

    console.log(`  APPLIED. New asset ${created!.id} (${stem}_retouched.png), status "uploaded" so it still needs review.`);
    console.log(`  The original is untouched on disk and now blocked from generation, linked both ways in aiSuggestedFields.`);
  }
  console.log("");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
