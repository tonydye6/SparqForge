/**
 * Block the assets doc 27 names as carrying a specific third-party mark.
 *
 * WHY THIS EXISTS AS DATA AND NOT AS A MIGRATION BACKFILL: these rows are
 * invisible to M3's backfill. They have no `conflictTags`, no `retouched_to`
 * link, and `generationAllowed = true` — from the database's point of view they
 * look like ordinary clean assets. The only record that they carry a mark is a
 * markdown table in `27_TRADEMARK_REMEDIATION.md`, written from a manual survey
 * whose findings were never persisted. This script is that table, promoted to
 * something executable.
 *
 * Verified against the live dev library on 2026-08-08: of the 17 images the doc
 * names, 6 rows were still `generationAllowed = true`. Every one is an
 * `subject_reference`, which is the worst class for this — a subject reference is
 * copied exactly by the identity lock, so a mark on one reproduces in every
 * image generated from that character.
 *
 * This is deliberately CONSERVATIVE and REVERSIBLE. It sets state and flips
 * `generationAllowed` to false; it deletes nothing and moves no files. Blocking
 * is the safe direction: a wrongly-blocked asset costs somebody a click, a
 * wrongly-allowed one puts a trademark into published output.
 *
 * It is NOT a substitute for a re-scan. The scanner found 46 contaminated images
 * and that list was never written down; this recovers only the subset a human
 * had already named. `--dry-run` first, always.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/block-named-trademark-assets.ts --dry-run
 */
import { db, assetsTable } from "@workspace/db";
import { and, eq, like, or } from "drizzle-orm";

/**
 * Doc 27 §"Wave 1" — image name stem → the mark identified there.
 *
 * Matched by PREFIX because one image can have several rows under near-identical
 * names (`_01`, `.png` vs `.jpeg`, a `_resized` variant), and the duplicate rows
 * are exactly what the original remediation missed. `_retouched` outputs are
 * excluded: those are the replacements, governed by review state, not by this.
 */
const NAMED_MARKS: ReadonlyArray<{ stem: string; marks: string[] }> = [
  { stem: "crownu_char_male_sparq_football_default",       marks: ["jordan_jumpman", "georgia_g"] },
  { stem: "crownu_char_unknown_lsu_unknown_unknown",       marks: ["nba_logoman"] },
  { stem: "sparq_branded_basketball_character_female",     marks: ["nba_logoman"] },
  { stem: "crownu_char_male_unknown_soccer_unknown_01",    marks: ["nike_swoosh", "texas_longhorn"] },
  { stem: "crownu_char_unknown_lsu_soccer_unknown_01",     marks: ["nike_swoosh", "lsu_wordmark"] },
  { stem: "crownu_char_unknown_wisconsin_unknown_unknown", marks: ["adidas_three_stripes"] },
  { stem: "crownu_char_female_sparq_track_default",        marks: ["nike_swoosh"] },
  { stem: "crownu_char_female_sparq_soccer_default",       marks: ["nike_swoosh"] },
  { stem: "crownu_char_female_blue_tennis_default",        marks: ["nike_swoosh"] },
  { stem: "Sparq_female_basketball",                       marks: ["nike_swoosh"] },
  { stem: "Sparq_male_blue_football_ball",                 marks: ["nike_swoosh"] },
  { stem: "crownu_char_unknown_miami_unknown_unknown_01",  marks: ["nike_swoosh"] },
  { stem: "crownu_char_unknown_miami_unknown_unknown_02",  marks: ["nike_swoosh"] },
  { stem: "crownu_char_unknown_miami_unknown_unknown_04",  marks: ["nike_swoosh"] },
  { stem: "crownu_char_female_unknown_tennis",             marks: ["nike_swoosh"] },
  { stem: "sparq_branded_basketball_character_male-1",     marks: ["duke_d"] },
  { stem: "sparq_branded_tennis_character_female",         marks: ["nike_swoosh"] },
];

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(dryRun ? "\nDRY RUN — nothing will be written\n" : "\nAPPLYING\n");

  let blocked = 0, alreadyBlocked = 0, notFound = 0;

  for (const { stem, marks } of NAMED_MARKS) {
    const rows = await db
      .select()
      .from(assetsTable)
      .where(like(assetsTable.name, `${stem}%`));

    // A replacement's own name starts with the original's stem, so exclude it
    // here rather than in SQL — being explicit beats a cleverer LIKE pattern.
    const originals = rows.filter(r => !r.name.includes("_retouched"));
    if (originals.length === 0) { notFound++; console.log(`  --  ${stem}  (no rows)`); continue; }

    for (const r of originals) {
      if (r.generationAllowed === false) {
        alreadyBlocked++;
        continue;
      }
      console.log(`  BLOCK  ${r.name}  [${marks.join(", ")}]  class=${r.assetClass}`);
      if (!dryRun) {
        await db
          .update(assetsTable)
          .set({
            generationAllowed: false,
            trademarkScanState: "blocked",
            trademarkMarks: marks,
            trademarkScannedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(assetsTable.id, r.id));
      }
      blocked++;
    }
  }

  console.log(`\n  ${blocked} row(s) ${dryRun ? "would be" : ""} blocked`);
  console.log(`  ${alreadyBlocked} already blocked (left alone)`);
  console.log(`  ${notFound} stem(s) matched nothing\n`);
  console.log(
    "  NOT a re-scan. The scanner found 46 contaminated images and that list was\n" +
    "  never persisted; this recovers only what a human had already named.\n",
  );
}

await main();
process.exit(0);
