/**
 * Write the 2026-08-08 re-scan verdicts into the M3 trademark columns.
 *
 * WHY THIS EXISTS: migration 0031's backfill can only lift what the database
 * already held — the `"retouched_to:<uuid>"` strings the August remediation
 * pushed into `ai_suggested_fields`. It recovers the LINEAGE. It cannot recover
 * the VERDICTS, because the scanner's findings were never persisted anywhere;
 * they existed only in a session transcript until the 2026-08-08 re-scan wrote
 * them to `data/trademark-rescan-2026-08-08.json`. This script is the other
 * half: the migration supplies who-replaced-whom, this supplies what-was-found.
 *
 * ── The rules, and why each one is the honest reading ────────────────────────
 *
 *  severity `blocked`  → state `blocked`, EVEN IF the row is a `replacement`.
 *      This is the case that matters most. `crownu_char_female_unknown_tennis_
 *      unknown_retouched.jpg` is a retouched output that STILL carries a Nike
 *      swoosh on the shoe heels and a Miami "U". Leaving it `replacement` would
 *      file it as "clean pending a click", when the scanner has already said it
 *      is not clean. Lineage is not lost by this: `retouchedFromAssetId` is a
 *      real FK and still says where the row came from. The state column carries
 *      the VERDICT; the FK carries the HISTORY. They are different questions.
 *
 *  state `retouched`   → left alone, whatever the scan says.
 *      That state means "a replacement exists, use that instead", which is
 *      strictly more actionable than repeating that the original is dirty. It
 *      is already ineligible either way. Note the scanner clears a few of these
 *      — see doc 30 §4; the two records disagree in both directions and neither
 *      is complete, so the conservative state stays.
 *
 *  severity `clear` on a `replacement` → stays `replacement`.
 *      A clean scan is not a human sign-off. The gate deliberately holds
 *      replacements until someone sets `trademarkReviewedAt`, because the
 *      failure the review catches is not "a mark the scanner sees" but
 *      "the retouch corrupted the SPARQ wordmark to SPARR". Promoting these to
 *      `clean` here would silently defeat that gate for 27 rows.
 *
 *  severity `review`   → state `review`.
 *      The scanner found a mark it believes an existing licence may cover and
 *      explicitly declined to rule. Folding that into `clean` asserts a ruling
 *      nobody made.
 *
 *  NOTHING is ever set to `refused`. A refusal asserts that a retouch was
 *      attempted and failed, and no record of which retouches were attempted
 *      survives — that erasure is the original defect. Inventing it here would
 *      manufacture the evidence whose absence M3 exists to fix.
 *
 *  Rows the scan never covered keep `trademark_scan_state = NULL`.
 *      NULL reads as "never scanned" and the gate treats it as permissive.
 *      `sparq_branded_soccer_character_female.png` is in this set: it errored
 *      during the re-scan and MUST NOT come out of this looking clean.
 *
 * `trademarkMarks` is overwritten with the scanner's mark NAMES ("Nike Swoosh"),
 * replacing the slugs 0031 lifted out of `conflictTags`. The scan is the record
 * of truth about what is in the image; `conflictTags` remains what it always
 * was, a collision-avoidance key. Locations (`headband`, `shoe tongues`) stay in
 * the JSON rather than being crammed into the array, so the column stays
 * groupable — "how many images carry a Nike swoosh" has to be one query.
 *
 * Run (ALWAYS dry-run first):
 *   pnpm --filter @workspace/scripts exec tsx src/write-trademark-verdicts.ts --dry-run
 *   pnpm --filter @workspace/scripts exec tsx src/write-trademark-verdicts.ts --apply
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { db, assetsTable } from "@workspace/db";
import type { TrademarkScanState } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

interface Finding {
  mark: string;
  kind: string;
  where: string;
  confidence: number;
}
interface ScanRecord {
  hash: string;
  assetIds: string[];
  names: string[];
  assessment: {
    severity: "clear" | "blocked" | "review";
    findings: Finding[];
    reason: string;
    recommendBlock: boolean;
  };
}
interface ScanFile {
  brand: { id: string; name: string };
  scannedAt: string;
  totals: Record<string, number>;
  records: ScanRecord[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const SCAN_PATH = path.join(here, "../data/trademark-rescan-2026-08-08.json");

const apply = process.argv.includes("--apply");
const dryRun = !apply;

/** The verdict this scan record implies, given what the row already says. */
function resolveState(
  severity: ScanRecord["assessment"]["severity"],
  current: TrademarkScanState | null,
): { next: TrademarkScanState; note: string } {
  if (current === "retouched") {
    return { next: "retouched", note: "kept — a replacement exists and supersedes it" };
  }
  if (severity === "blocked") {
    return current === "replacement"
      ? { next: "blocked", note: "REPLACEMENT STILL CARRIES A MARK — downgraded to blocked" }
      : { next: "blocked", note: "scan found a mark" };
  }
  if (severity === "review") {
    return { next: "review", note: "licence question — a human decides" };
  }
  if (current === "replacement") {
    return { next: "replacement", note: "clean scan is not a human sign-off; still awaiting review" };
  }
  return { next: "clean", note: "scanned, no third-party mark" };
}

async function main(): Promise<void> {
  const scan: ScanFile = JSON.parse(readFileSync(SCAN_PATH, "utf8"));
  console.log(
    `\n${dryRun ? "DRY RUN — nothing will be written" : "APPLYING"}\n` +
      `  scan: ${scan.scannedAt}  brand: ${scan.brand.name}  records: ${scan.records.length}\n`,
  );

  // One read of every id the scan mentions. Reading per-record would issue 271
  // round trips against a remote database for no benefit.
  const scannedIds = [...new Set(scan.records.flatMap((r) => r.assetIds))];
  const existing = await db
    .select({
      id: assetsTable.id,
      name: assetsTable.name,
      state: assetsTable.trademarkScanState,
    })
    .from(assetsTable)
    .where(inArray(assetsTable.id, scannedIds));
  const byId = new Map(existing.map((r) => [r.id, r]));

  const tally: Record<string, number> = {};
  const notes: string[] = [];
  let missing = 0;
  let unchanged = 0;
  let written = 0;

  for (const record of scan.records) {
    const marks = [...new Set(record.assessment.findings.map((f) => f.mark))];
    for (const id of record.assetIds) {
      const row = byId.get(id);
      if (!row) {
        missing++;
        continue;
      }
      const { next, note } = resolveState(
        record.assessment.severity,
        row.state as TrademarkScanState | null,
      );
      tally[next] = (tally[next] ?? 0) + 1;
      if (next !== row.state) {
        notes.push(
          `  ${(row.state ?? "(null)").padEnd(12)} → ${next.padEnd(12)} ${row.name}\n` +
            `${" ".repeat(31)}${note}${marks.length ? `  [${marks.join(", ")}]` : ""}`,
        );
      } else {
        unchanged++;
      }
      if (!dryRun) {
        await db
          .update(assetsTable)
          .set({
            trademarkScanState: next,
            trademarkMarks: marks,
            trademarkScannedAt: new Date(scan.scannedAt),
            updatedAt: new Date(),
          })
          .where(eq(assetsTable.id, id));
      }
      written++;
    }
  }

  // Only the transitions, not 298 lines of "clean → clean".
  console.log(notes.slice(0, 60).join("\n"));
  if (notes.length > 60) console.log(`  … and ${notes.length - 60} more transitions`);

  console.log(`\n  resulting state across the ${written} scanned rows:`);
  for (const [state, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${state.padEnd(12)} ${n}`);
  }
  console.log(`\n  ${notes.length} row(s) ${dryRun ? "would change" : "changed"} state`);
  console.log(`  ${unchanged} already correct`);
  console.log(`  ${missing} scanned id(s) no longer in the database`);
  console.log(
    `\n  Rows the scan never covered are untouched and stay NULL — that includes\n` +
      `  sparq_branded_soccer_character_female.png, which errored during the scan\n` +
      `  and must not read as clean.\n`,
  );
}

await main();
process.exit(0);
