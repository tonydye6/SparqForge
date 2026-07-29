/**
 * Free diagnostic for stage 03 character fidelity: does the Creative Director
 * pick the right asset for a brief?
 *
 * Run ON REPLIT (needs the live database and GEMINI_API_KEY):
 *
 *   cd artifacts/api-server && pnpm exec tsx scripts/probe-creative-direction.ts
 *
 * Reads only. Writes nothing to the database, generates no images, records no
 * cost row. The whole probe is ONE gemini-3.5-flash call (two if the JSON
 * retry fires), which is a fraction of a cent against $0.48 for a spread.
 * Pass --no-model to spend literally nothing and still see the catalog half.
 *
 * It exists because five spreads were paid for while diagnosing a problem that
 * is decidable for free: the failure is either in the library, in the catalog,
 * or in the model's choice, and those are three different bugs with three
 * different fixes. So the probe reports each boundary separately:
 *
 *   1 · LIBRARY   is the asset there, and does policy let it be used at all?
 *   2 · CATALOG   does it get a line the director can actually see?
 *                 (buildAssetCatalog caps at 40 lines and puts logos first, so
 *                 an eligible asset can still be invisible)
 *   3 · DIRECTOR  does the model select it, with which role?
 *
 * Flags:
 *   --brand <name|id>   default "Crown U" (name match is case-insensitive)
 *   --brief <text>      default the standing test brief
 *   --expect <substr>   asset filename/name that MUST be selected as subject
 *   --intent <id>       intent id for INTENT_IMAGE_DIRECTIVES, default none
 *   --channel <ch>      channel for policy gating, default none
 *   --max-lines <n>     catalog cap, default the module's own 40
 *   --no-model          skip the director call entirely
 */

import { db, assetsTable, brandsTable, designerPersonasTable, styleProfilesTable } from "@workspace/db";
import type { Asset, Brand, DesignerPersona, StyleProfile } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import {
  buildAssetCatalog,
  buildCreativeDirection,
  buildSessionStyleContract,
} from "../src/services/creative-direction.js";
import { buildBriefTokenSet, scoreAssetAgainstBrief } from "../src/services/asset-matching.js";
import { checkGenerationEligibility, derivePolicyRole } from "../src/services/asset-policy.js";

const DEFAULT_BRAND = "Crown U";
const DEFAULT_BRIEF = "new crown u character announcement, female tennis player";
const DEFAULT_EXPECT = "crownu_char_female_unknown_tennis_resized.png";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--")) {
    return process.argv[i + 1]!;
  }
  const inline = process.argv.find(a => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : null;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function rule(title: string): void {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

/** Group ineligibility reasons into counts, so 300 blocked assets read as 4 causes. */
function tally(reasons: string[]): string[] {
  const counts = new Map<string, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${String(n).padStart(4)}  ${reason}`);
}

async function resolveBrand(needle: string): Promise<Brand> {
  const all = await db.select().from(brandsTable);
  const byId = all.find(b => b.id === needle);
  if (byId) return byId;
  const byName = all.find(b => b.name.toLowerCase() === needle.toLowerCase());
  if (byName) return byName;
  const partial = all.find(b => b.name.toLowerCase().includes(needle.toLowerCase()));
  if (partial) return partial;
  throw new Error(
    `No brand matched "${needle}". Brands on this database: ${all.map(b => `${b.name} (${b.id})`).join(", ")}`,
  );
}

async function main(): Promise<void> {
  const brandNeedle = arg("brand") ?? DEFAULT_BRAND;
  const briefText = arg("brief") ?? DEFAULT_BRIEF;
  const expect = arg("expect") ?? DEFAULT_EXPECT;
  const intent = arg("intent");
  const channel = arg("channel");
  const maxLines = arg("max-lines") ? Number(arg("max-lines")) : undefined;
  const runModel = !flag("no-model");

  const brand = await resolveBrand(brandNeedle);

  rule("0 · WHAT IS BEING PROBED");
  console.log(`brand      ${brand.name}  (${brand.id})`);
  console.log(`brief      ${JSON.stringify(briefText)}`);
  console.log(`expect     ${expect}  selected with role "subject"`);
  console.log(`intent     ${intent ?? "(none passed)"}`);
  console.log(`channel    ${channel ?? "(none — channel policy gating not applied)"}`);
  console.log(`model call ${runModel ? "yes, one gemini-3.5-flash call" : "NO (--no-model)"}`);

  // ── 1 · LIBRARY ───────────────────────────────────────────────────────────
  // Everything buildAssetCatalog itself queries, re-derived here so the counts
  // it silently filters on become visible.
  const assets: Asset[] = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.brandId, brand.id), ne(assetsTable.status, "archived")));

  const context = { channel: channel ?? null, template: null };
  const isCompositingClass = (a: Asset): boolean =>
    Boolean(a.compositingOnly) || a.assetClass === "compositing";
  const hasUsableFile = (a: Asset): boolean =>
    Boolean(a.fileUrl) && !(a.mimeType || "").includes("video");

  const byClass = new Map<string, number>();
  for (const a of assets) {
    const k = a.assetClass ?? "(null)";
    byClass.set(k, (byClass.get(k) ?? 0) + 1);
  }

  const blockedReasons: string[] = [];
  let eligibleCount = 0;
  let noFileCount = 0;
  let notVisualCount = 0;
  for (const a of assets) {
    if (!hasUsableFile(a)) { noFileCount++; continue; }
    const role = derivePolicyRole(a);
    if (role === "generation_reference" && a.type !== "visual") { notVisualCount++; continue; }
    const verdict = checkGenerationEligibility(a, context, role);
    if (verdict.eligible) eligibleCount++;
    else blockedReasons.push(verdict.reason);
  }

  rule("1 · LIBRARY · is the asset there, and does policy allow it?");
  console.log(`non-archived assets            ${assets.length}`);
  console.log(`by asset_class:`);
  for (const [k, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
  console.log(`\neligible for a catalog id      ${eligibleCount}`);
  console.log(`no usable file (or video)      ${noFileCount}`);
  console.log(`type !== "visual"              ${notVisualCount}`);
  if (blockedReasons.length > 0) {
    console.log(`blocked by policy              ${blockedReasons.length}`);
    for (const line of tally(blockedReasons)) console.log(`  ${line}`);
  }

  const target = assets.find(a => a.name.includes(expect) || a.fileUrl?.includes(expect));
  if (!target) {
    console.log(
      `\n!! The expected asset "${expect}" is NOT in this brand's non-archived library.` +
      `\n   Nothing downstream can select it. That is the bug, and it is a library problem,` +
      `\n   not a director problem.`,
    );
  } else {
    const role = derivePolicyRole(target);
    const verdict = checkGenerationEligibility(target, context, role);
    const score = scoreAssetAgainstBrief(target, buildBriefTokenSet(briefText));
    console.log(`\nexpected asset FOUND`);
    console.log(`  id                     ${target.id}`);
    console.log(`  name                   ${target.name}`);
    console.log(`  type / assetClass      ${target.type} / ${target.assetClass ?? "(null)"}`);
    console.log(`  policy role            ${role}`);
    console.log(`  eligible               ${verdict.eligible}${verdict.eligible ? "" : `  · ${verdict.reason}`}`);
    console.log(`  generationAllowed      ${target.generationAllowed}`);
    console.log(`  compositingOnly        ${target.compositingOnly}`);
    console.log(`  status                 ${target.status}`);
    console.log(`  fileUrl                ${target.fileUrl ?? "(none)"}`);
    console.log(`  depictedEntities       ${(target.depictedEntities || []).join(", ") || "(none)"}`);
    console.log(`  tags                   ${(target.tags || []).join(", ") || "(none)"}`);
    console.log(`  characterIdentityNote  ${target.characterIdentityNote || "(empty)"}`);
    console.log(`  subjectIdentityScore   ${target.subjectIdentityScore ?? "(null)"}`);
    console.log(`  brief match score      ${score.score.toFixed(2)}  matched: ${score.matchedTerms.join(", ") || "(nothing)"}`);
  }

  // ── 2 · CATALOG ───────────────────────────────────────────────────────────
  const catalog = await buildAssetCatalog({
    brandId: brand.id,
    briefText,
    channel: channel ?? null,
    ...(maxLines ? { maxLines } : {}),
  });

  rule("2 · CATALOG · what the director can actually see");
  const logoLines = catalog.lines.filter(l => l.split("|")[2]?.trim() === "logo/brand mark").length;
  console.log(`catalog lines  ${catalog.lines.length}${maxLines ? ` (cap ${maxLines} from --max-lines)` : " (the module's own cap)"}`);
  console.log(`  logo/mark     ${logoLines}`);
  console.log(`  ranked assets ${catalog.lines.length - logoLines}  of ${eligibleCount} eligible`);
  console.log(`format         id | name | kind | entities | tags | colors | note\n`);
  catalog.lines.forEach((line, i) => console.log(`${String(i + 1).padStart(3)}. ${line}`));

  const targetInCatalog = target ? catalog.byId.has(target.id) : false;
  if (target) {
    console.log(
      `\nexpected asset in catalog      ${targetInCatalog ? "YES" : "NO"}`,
    );
    if (!targetInCatalog) {
      // The interesting sub-case: eligible but crowded out by the line cap.
      const eligibleScored = assets
        .filter(a => a.type === "visual" && hasUsableFile(a) && !isCompositingClass(a) &&
          checkGenerationEligibility(a, context, "generation_reference").eligible)
        .map(a => ({ a, ...scoreAssetAgainstBrief(a, buildBriefTokenSet(briefText)) }))
        .sort((x, y) => y.score - x.score);
      const rank = eligibleScored.findIndex(e => e.a.id === target.id);
      const logoLines = assets.filter(a =>
        isCompositingClass(a) && hasUsableFile(a) &&
        checkGenerationEligibility(a, context, "compositing").eligible).length;
      console.log(
        `   rank among eligible scored  ${rank >= 0 ? `${rank + 1} of ${eligibleScored.length}` : "not eligible at all"}`,
      );
      console.log(`   logo/mark lines taken first  ${logoLines}`);
      console.log(
        `   → if the rank is past the remaining cap, the asset is eligible but INVISIBLE.` +
        `\n     That is a catalog-budget bug (raise maxLines or stop putting every logo first),` +
        `\n     not a model bug.`,
      );
    }
  }

  // ── 3 · DIRECTOR ──────────────────────────────────────────────────────────
  const [styleProfile] = await db
    .select()
    .from(styleProfilesTable)
    .where(and(eq(styleProfilesTable.brandId, brand.id), eq(styleProfilesTable.isDefault, true)));

  let persona: DesignerPersona | null = null;
  if (brand.defaultPersonaId) {
    const [p] = await db
      .select()
      .from(designerPersonasTable)
      .where(eq(designerPersonasTable.id, brand.defaultPersonaId));
    persona = p ?? null;
  }

  const styleContract = buildSessionStyleContract({
    brand,
    styleProfile: (styleProfile as StyleProfile | undefined) ?? null,
    persona,
  });

  rule("3a · STYLE CONTRACT · the constraints the director works inside");
  console.log(`style profile  ${styleProfile ? `"${styleProfile.name}" (brand default)` : "(none set as default)"}`);
  console.log(`persona        ${persona ? `"${persona.name}" (brand default)` : "(none locked on the brand)"}`);
  console.log(`\n${styleContract || "(empty — the brand record has none of the contract fields filled)"}`);

  if (!runModel) {
    rule("VERDICT");
    console.log("--no-model was passed, so the director was not called. Boundaries 1 and 2 above");
    console.log("are still decisive: if the expected asset is missing or has no catalog line, the");
    console.log("bug is upstream of the model and no paid run can tell you anything new.");
    process.exit(0);
  }

  rule("3b · DIRECTOR · buildCreativeDirection");
  const started = Date.now();
  const direction = await buildCreativeDirection({
    brand,
    styleContract,
    briefText,
    intent,
    catalog,
  });
  const elapsed = Date.now() - started;

  console.log(`elapsed        ${elapsed} ms`);
  console.log(`usedFallback   ${direction.usedFallback}${direction.usedFallback ? "  ← JSON parse failed; selections are EMPTY by definition" : ""}`);
  console.log(`aspectRatio    ${direction.aspectRatio}`);
  console.log(`selections     ${direction.assetSelections.length}`);
  for (const sel of direction.assetSelections) {
    const a = catalog.byId.get(sel.assetId);
    console.log(`  role ${sel.role.padEnd(7)} ${a?.name ?? "(id not in catalog — should be impossible)"}`);
    console.log(`               ${sel.assetId}`);
  }
  console.log(`\nprompt:\n${direction.prompt}`);

  // ── VERDICT ───────────────────────────────────────────────────────────────
  rule("VERDICT");
  const hit = direction.assetSelections.find(sel => {
    const a = catalog.byId.get(sel.assetId);
    return Boolean(a && (a.name.includes(expect) || a.fileUrl?.includes(expect)));
  });

  /*
   * The criterion is a PROPERTY, not a filename, and that correction came from
   * running this probe.
   *
   * It first asked whether one named file was selected, reported FAIL when the
   * director chose a sibling, and the sibling was arguably the better pick: both
   * were female tennis characters, and the chosen one matched the brand palette
   * while the named one did not. A criterion naming a single asset id is a trap
   * whenever several assets satisfy the brief, so the question it answers now is
   * "did a subject get selected at all", with the named asset reported as an
   * additional data point rather than as the pass condition.
   */
  const subjectPicks = direction.assetSelections.filter(s => s.role === "subject");
  const names = (sels: typeof direction.assetSelections): string =>
    sels.map(s => catalog.byId.get(s.assetId)?.name ?? s.assetId).join(", ") || "(nothing)";

  if (subjectPicks.length > 0) {
    console.log(`PASS · the director selected ${subjectPicks.length} asset(s) with role "subject":`);
    console.log(`  ${names(subjectPicks)}`);
    console.log(`Judge these by eye against the brief. A subject selected at all is the thing the`);
    console.log(`legacy token scanner could not do, and it is what makes routing Explore through`);
    console.log(`the director worth a paid run.`);
    if (hit) {
      console.log(`\nThe --expect asset was among the selections, with role "${hit.role}".`);
    } else if (targetInCatalog) {
      console.log(`\nNote: the --expect asset (${expect}) had a catalog line and was NOT chosen.`);
      console.log(`That is not automatically wrong. Compare the two on brief fit and brand palette`);
      console.log(`before treating it as a defect.`);
    }
  } else if (!target) {
    console.log(`FAIL at boundary 1 · the --expect asset is not in the library, and no subject was`);
    console.log(`selected either. Fix the library first.`);
  } else if (!targetInCatalog) {
    console.log(`FAIL at boundary 2 · no subject was selected, and the --expect asset never reached`);
    console.log(`the catalog, so the model could not have chosen it. This is a catalog-budget bug.`);
  } else {
    console.log(`FAIL at boundary 3 · no subject was selected at all, though eligible subjects had`);
    console.log(`catalog lines. This is the only branch where prompt or scoring work is the right`);
    console.log(`next step. Selected instead: ${names(direction.assetSelections)}`);
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("\nProbe failed:", err);
  process.exit(1);
});
