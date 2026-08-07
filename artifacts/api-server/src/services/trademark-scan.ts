/**
 * Find third-party trademarks that are BAKED INTO a source asset.
 *
 * Why this exists, and why it cannot be a prompt fix:
 *
 * On 2026-08-07 three separate Crown U renders came back with a Nike swoosh on
 * the jersey and a B1G mark at the collar, on a brand whose `negativePrompt`
 * already says "no non-Crown-U logos". The marks were in the character
 * reference itself. The identity lock exists to make the renderer copy that
 * reference exactly — that was the whole Phase 4 fix — so asking it to copy the
 * character but drop the logo ON the character is asking for two contradictory
 * things, and the lock wins. Every prompt variation left the marks untouched.
 *
 * So the check belongs at the ASSET, before anything is generated from it.
 *
 * Deliberately NOT reusing `conflictTags`. That field is a mutual-exclusion
 * mechanism: `session-service` drops any slot whose tags clash with a slot
 * already claimed, so two assets both tagged "nike" would silently stop
 * co-appearing. Different question, different field. The gate here is
 * `generationAllowed`, which asset-policy already honours for exactly this
 * role.
 *
 * Pure: no DB, no clock, no model call. The script does the I/O.
 */

/** What kind of holder the mark belongs to. Drives severity. */
export type MarkKind =
  | "sportswear"    // Nike, Adidas, Under Armour, Jordan
  | "league"        // NFL, NBA, MLB
  | "conference"    // Big Ten, SEC, ACC
  | "university"    // a specific school's marks
  | "broadcaster"   // ESPN, Fox Sports
  | "other";

/** How much trouble a finding is for the brand that owns the asset. */
export type Severity = "clear" | "review" | "blocked";

export interface TrademarkFinding {
  /** Human-readable, e.g. "Nike swoosh". */
  mark: string;
  kind: MarkKind;
  /** Where on the asset, e.g. "jersey chest". Helps whoever retouches it. */
  where: string;
  /** 0-1. Findings below CONFIDENCE_FLOOR are discarded, not reported. */
  confidence: number;
}

export interface ScanAssessment {
  severity: Severity;
  findings: TrademarkFinding[];
  /** One sentence, written for a human deciding what to do. */
  reason: string;
  /** True when the asset should stop being used as a generation reference. */
  recommendBlock: boolean;
}

/**
 * Below this a "finding" is the model pattern-matching on a swoosh-shaped
 * highlight. Set high on purpose: a false positive here pulls a working asset
 * out of the library, which is a worse day than a missed mark on one post.
 */
export const CONFIDENCE_FLOOR = 0.6;

/**
 * Kinds the brand can never have a licence for, so any confident hit blocks.
 * University and conference marks are `review` instead: Crown U is an
 * NCAA/CLC-licensed product, so a school mark may be entirely legitimate and
 * that is a question for a human with the licence in front of them.
 */
const BLOCKING_KINDS: ReadonlySet<MarkKind> = new Set<MarkKind>([
  "sportswear",
  "league",
  "broadcaster",
]);

export const TRADEMARK_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          mark: { type: "string" },
          kind: { type: "string", enum: ["sportswear", "league", "conference", "university", "broadcaster", "other"] },
          where: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["mark", "kind", "where", "confidence"],
      },
    },
  },
  required: ["findings"],
} as const;

/**
 * The brand's OWN marks must never be reported. Flagging the Sparq skull as a
 * third-party trademark would make this tool worse than useless: it would
 * recommend blocking the assets the brand exists to use.
 */
export function buildTrademarkSystemPrompt(brandName: string, ownMarks: readonly string[]): string {
  const own = ownMarks.length > 0
    ? ownMarks.map(m => `- ${m}`).join("\n")
    : "- (none recorded)";

  return `You are checking one image asset belonging to the brand "${brandName}" for trademarks owned by SOMEONE ELSE.

Return ONLY: { "findings": [ { "mark": "...", "kind": "...", "where": "...", "confidence": 0.0 } ] }

"kind" is one of: sportswear, league, conference, university, broadcaster, other.

THESE MARKS BELONG TO THIS BRAND. Never report them, no matter how prominent:
${own}

RULES:
- Report a mark only if you can actually SEE it. Do not infer a sponsor from a colourway, a silhouette or a style of kit.
- A swoosh, three stripes, a jumpman, a conference shield, a league shield, a broadcaster bug: these are what you are looking for.
- "where" must say where on the image it sits, e.g. "jersey chest", "left shoe", "collar", so someone can retouch it.
- "confidence" is your honest read that this specific mark is present and identifiable. A shape that merely resembles a logo is below 0.5.
- Finding nothing is a correct and common answer. Return an empty array rather than reaching for something.`;
}

function isFinding(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const VALID_KINDS: ReadonlySet<string> = new Set([
  "sportswear", "league", "conference", "university", "broadcaster", "other",
]);

/**
 * Validate a model response into findings, dropping anything malformed or
 * low-confidence. Returns what was dropped so a scan can say so out loud
 * instead of quietly reporting a shorter list.
 */
export function parseTrademarkFindings(
  raw: unknown,
  ownMarks: readonly string[] = [],
): { findings: TrademarkFinding[]; rejected: Array<{ mark: string; reason: string }> } {
  const findings: TrademarkFinding[] = [];
  const rejected: Array<{ mark: string; reason: string }> = [];

  const list = isFinding(raw) && Array.isArray((raw as { findings?: unknown }).findings)
    ? ((raw as { findings: unknown[] }).findings)
    : [];

  // Compared case-insensitively and by substring, because a model asked not to
  // report "Crown U" will happily report "Crown U crown logo".
  const own = ownMarks.map(m => m.trim().toLowerCase()).filter(Boolean);

  for (const item of list) {
    if (!isFinding(item)) continue;
    const mark = typeof item.mark === "string" ? item.mark.trim() : "";
    const kind = typeof item.kind === "string" ? item.kind : "";
    const where = typeof item.where === "string" ? item.where.trim() : "";
    const confidence = typeof item.confidence === "number" ? item.confidence : NaN;

    if (!mark) continue;
    if (!VALID_KINDS.has(kind)) { rejected.push({ mark, reason: `unknown kind "${kind}"` }); continue; }
    if (!Number.isFinite(confidence)) { rejected.push({ mark, reason: "no numeric confidence" }); continue; }

    const lower = mark.toLowerCase();
    if (own.some(o => lower.includes(o) || o.includes(lower))) {
      rejected.push({ mark, reason: "belongs to this brand" });
      continue;
    }
    if (confidence < CONFIDENCE_FLOOR) {
      rejected.push({ mark, reason: `confidence ${confidence.toFixed(2)} below ${CONFIDENCE_FLOOR}` });
      continue;
    }

    findings.push({ mark, kind: kind as MarkKind, where: where || "unstated", confidence });
  }

  // Highest confidence first: whoever reads this should see the certain ones.
  findings.sort((a, b) => b.confidence - a.confidence || a.mark.localeCompare(b.mark));
  return { findings, rejected };
}

export interface AssessOptions {
  /**
   * Mark kinds this brand demonstrably has a licence for. They are still
   * REPORTED — never hide a mark — but they stop driving severity, so a
   * library of legitimately licensed collegiate art does not bury the one
   * asset with a swoosh on it.
   *
   * Set for Crown U on 2026-08-07: Tony confirmed the university and
   * conference marks across the character library are licensed and fine.
   */
  licensedKinds?: readonly MarkKind[];
}

/** Turn findings into a decision and a sentence a human can act on. */
export function assessAsset(
  findings: readonly TrademarkFinding[],
  opts: AssessOptions = {},
): ScanAssessment {
  if (findings.length === 0) {
    return { severity: "clear", findings: [], reason: "No third-party marks found.", recommendBlock: false };
  }

  const licensed = new Set<MarkKind>(opts.licensedKinds ?? []);
  const unlicensed = findings.filter(f => !licensed.has(f.kind));

  if (unlicensed.length === 0) {
    // Everything found is covered. Say what was seen anyway: "clear" must not
    // mean "nothing there", or the next person cannot audit the decision.
    const seen = findings.map(f => `${f.mark} (${f.where})`).join(", ");
    return {
      severity: "clear",
      findings: [...findings],
      reason: `Only licensed marks found: ${seen}.`,
      recommendBlock: false,
    };
  }

  const blocking = unlicensed.filter(f => BLOCKING_KINDS.has(f.kind));
  if (blocking.length > 0) {
    const names = blocking.map(f => `${f.mark} (${f.where})`).join(", ");
    /*
     * Name the institutional marks too. An earlier version listed only the
     * blocking ones, so an asset carrying both a swoosh and a B1G shield
     * reported the swoosh and silently dropped the shield — and anyone reading
     * the summary rather than the per-asset line would never learn the second
     * one was there. For a compliance report, an omission reads as an all-clear.
     */
    const others = findings.filter(f => !BLOCKING_KINDS.has(f.kind) || licensed.has(f.kind));
    const also = others.length > 0
      ? ` Also present, and a separate question for whoever holds the licence: ${others.map(f => `${f.mark} (${f.where})`).join(", ")}.`
      : "";
    return {
      severity: "blocked",
      findings: [...findings],
      reason: `Carries third-party commercial marks this brand cannot licence: ${names}. Anything generated from this asset inherits them.${also}`,
      recommendBlock: true,
    };
  }

  const names = unlicensed.map(f => `${f.mark} (${f.where})`).join(", ");
  return {
    severity: "review",
    findings: [...findings],
    reason: `Carries institutional marks that may be covered by an existing licence: ${names}. A human with the licence terms decides.`,
    recommendBlock: false,
  };
}

/**
 * A one-line report row. Kept here rather than in the script so the formatting
 * is covered by the same assertions as the logic.
 */
export function formatScanRow(name: string, a: ScanAssessment): string {
  const tag = a.severity === "blocked" ? "BLOCKED" : a.severity === "review" ? "review " : "clear  ";
  const marks = a.findings.length > 0
    ? "  " + a.findings.map(f => `${f.mark}@${f.where} ${(f.confidence * 100).toFixed(0)}%`).join(" · ")
    : "";
  return `  ${tag}  ${name.slice(0, 52).padEnd(52)}${marks}`;
}

/* ------------------------------------------------------------------------- *
 * The ledger: one outcome per record, and a summary that has to add up.
 *
 * The first full run of this scan produced 268 targets and 267 verdict lines.
 * The missing one was an asset whose model call threw: the script printed an
 * ERROR line and moved on without counting it anywhere. On a compliance report
 * a row that leaves without a verdict, silently, is the worst possible failure
 * mode — it reads as an all-clear. So outcomes are now exhaustive and the
 * summary refuses to look tidy when it does not reconcile.
 * ------------------------------------------------------------------------- */

export type ScanOutcome =
  | "clear"
  | "review"
  | "blocked"
  | "duplicate"    // same bytes as an earlier record; inherits its verdict
  | "unreadable"   // file could not be fetched from disk or the server
  | "error";       // the model call threw

export interface ScanRecord {
  assetId: string;
  name: string;
  /** Hash of the file bytes. Null when the file could not be read. */
  contentKey: string | null;
  outcome: ScanOutcome;
  /** Present for clear/review/blocked, and for a duplicate inheriting one. */
  assessment: ScanAssessment | null;
  /** For a duplicate: the name of the record that was actually scanned. */
  duplicateOf?: string;
  /** For an error: what went wrong, so it can be retried deliberately. */
  errorMessage?: string;
}

export interface ScanSummary {
  /** How many records the scan set out to cover. */
  expected: number;
  counts: Record<ScanOutcome, number>;
  /** Distinct images actually sent to the model. */
  uniqueImagesScanned: number;
  /** Records that share bytes with an earlier one. */
  redundantRecords: number;
  /** expected minus the sum of every outcome. Must be 0. */
  unaccounted: number;
  reconciled: boolean;
  /**
   * Records needing a decision, deduplicated to one entry per image, with
   * every record that shares those bytes listed. This is the shortlist.
   */
  blockedGroups: BlockedGroup[];
}

export interface BlockedGroup {
  contentKey: string;
  /** The record that was scanned. */
  name: string;
  assessment: ScanAssessment;
  /** Every asset id carrying these bytes, INCLUDING the scanned one. */
  assetIds: string[];
  /** Every name these bytes are filed under. Often more than one. */
  names: string[];
}

const EMPTY_COUNTS = (): Record<ScanOutcome, number> => ({
  clear: 0, review: 0, blocked: 0, duplicate: 0, unreadable: 0, error: 0,
});

/**
 * Collapse a run of records into counts and the blocked shortlist.
 *
 * Grouping is by CONTENT KEY, deliberately, and neither by name nor by file
 * url. Crown U's library contains the same photograph filed under two names
 * (`..._sparq_track_default` and `..._unknown_track_unknown`) and the same
 * name pointing at two separate storage objects. Name-grouping misses the
 * first case, url-grouping misses the second, and a hash misses neither.
 *
 * A duplicate still gets its own row in `assetIds`. It inherits the verdict
 * but it is an independent gate: `generationAllowed` lives on the record, so
 * blocking one row and not its twin leaves the twin usable.
 */
export function summarizeScan(records: readonly ScanRecord[], expected: number): ScanSummary {
  const counts = EMPTY_COUNTS();
  for (const r of records) counts[r.outcome] += 1;

  const groups = new Map<string, BlockedGroup>();
  for (const r of records) {
    if (!r.contentKey || !r.assessment?.recommendBlock) continue;
    const existing = groups.get(r.contentKey);
    if (existing) {
      existing.assetIds.push(r.assetId);
      if (!existing.names.includes(r.name)) existing.names.push(r.name);
      continue;
    }
    groups.set(r.contentKey, {
      contentKey: r.contentKey,
      name: r.name,
      assessment: r.assessment,
      assetIds: [r.assetId],
      names: [r.name],
    });
  }

  const accounted = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    expected,
    counts,
    uniqueImagesScanned: counts.clear + counts.review + counts.blocked,
    redundantRecords: counts.duplicate,
    unaccounted: expected - accounted,
    reconciled: expected === accounted,
    blockedGroups: [...groups.values()],
  };
}

/** Every asset id that should be written when --flag is passed. */
export function assetIdsToFlag(summary: ScanSummary): string[] {
  return summary.blockedGroups.flatMap(g => g.assetIds);
}

/**
 * The summary block. Reconciliation is stated either way: a scan that silently
 * covers fewer records than it claimed is the defect this exists to prevent,
 * so "every record accounted for" has to be an assertion the report makes out
 * loud, not an absence of complaint.
 */
export function formatScanSummary(s: ScanSummary): string {
  const lines = [
    `  clear       ${s.counts.clear}`,
    `  review      ${s.counts.review}`,
    `  BLOCKED     ${s.counts.blocked}`,
  ];
  if (s.counts.duplicate > 0) {
    lines.push(`  duplicate   ${s.counts.duplicate}  (same bytes as another record; verdict inherited, no model call)`);
  }
  if (s.counts.unreadable > 0) {
    lines.push(`  unreadable  ${s.counts.unreadable}  (is the api-server running? try --server <url>)`);
  }
  if (s.counts.error > 0) {
    lines.push(`  ERRORED     ${s.counts.error}  (no verdict reached — rerun these before trusting this report)`);
  }
  lines.push("");
  lines.push(`  ${s.expected} record${s.expected === 1 ? "" : "s"} · ${s.uniqueImagesScanned} unique image${s.uniqueImagesScanned === 1 ? "" : "s"} scanned · ${s.blockedGroups.length} distinct image${s.blockedGroups.length === 1 ? "" : "s"} to decide about`);
  lines.push(s.reconciled
    ? `  Every record accounted for.`
    : `  ⚠ ${Math.abs(s.unaccounted)} record${Math.abs(s.unaccounted) === 1 ? "" : "s"} ${s.unaccounted > 0 ? "left this scan with NO verdict" : "were counted twice"}. This report is incomplete.`);
  return lines.join("\n");
}
