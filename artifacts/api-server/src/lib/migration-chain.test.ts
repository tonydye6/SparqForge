import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Guards the hand-written migration bookkeeping.
 *
 * A data-only migration (0047, 0048, 0049) is authored by hand rather than by
 * `drizzle-kit generate`, so its journal entry and its snapshot are written by
 * hand too. Get either wrong and the failure is silent and someone else's: a
 * missing snapshot breaks the NEXT `generate`, a broken `prevId` chain makes it
 * diff against the wrong baseline, and a journal tag with no matching file
 * fails at `migrate` time on whichever machine runs it first.
 */
const DRIZZLE = path.resolve(import.meta.dirname, "../../../../lib/db/drizzle");

interface JournalEntry { idx: number; version: string; when: number; tag: string; breakpoints: boolean }

const journal = JSON.parse(readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8")) as {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

describe("the migration journal", () => {
  it("has a .sql file for every entry", () => {
    for (const entry of journal.entries) {
      expect(existsSync(path.join(DRIZZLE, `${entry.tag}.sql`)), `${entry.tag}.sql`).toBe(true);
    }
  });

  it("has an entry for every .sql file", () => {
    const tagged = new Set(journal.entries.map(e => e.tag));
    for (const file of readdirSync(DRIZZLE).filter(f => f.endsWith(".sql"))) {
      expect(tagged.has(file.replace(/\.sql$/, "")), file).toBe(true);
    }
  });

  it("numbers entries consecutively and in time order", () => {
    journal.entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      expect(entry.tag.startsWith(String(i).padStart(4, "0")), entry.tag).toBe(true);
      if (i > 0) expect(entry.when).toBeGreaterThan(journal.entries[i - 1]!.when);
    });
  });

  /**
   * Snapshots for 0022, 0023 and 0025 were never committed — a pre-existing gap,
   * not something to fail the suite over. So the chain is checked only where
   * two consecutive snapshots both exist, which still catches a new migration
   * wired to the wrong parent.
   */
  const snapshotPath = (idx: number) =>
    path.join(DRIZZLE, `meta/${String(idx).padStart(4, "0")}_snapshot.json`);

  const readSnapshot = (idx: number) =>
    JSON.parse(readFileSync(snapshotPath(idx), "utf8")) as { id: string; prevId: string };

  it("links each snapshot to its predecessor wherever both are present", () => {
    for (const entry of journal.entries) {
      if (entry.idx === 0 || !existsSync(snapshotPath(entry.idx))) continue;
      if (!existsSync(snapshotPath(entry.idx - 1))) continue;
      expect(readSnapshot(entry.idx).prevId, `${entry.tag} prevId`)
        .toBe(readSnapshot(entry.idx - 1).id);
    }
  });

  it("gives every present snapshot a distinct id", () => {
    const ids = journal.entries
      .filter(entry => existsSync(snapshotPath(entry.idx)))
      .map(entry => readSnapshot(entry.idx).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chains 0049 onto 0048, the migration it was written against", () => {
    expect(readSnapshot(49).prevId).toBe(readSnapshot(48).id);
    expect(readSnapshot(49).id).not.toBe(readSnapshot(48).id);
  });
});

describe("0049, the prose-ownership backfill", () => {
  const sql = readFileSync(path.join(DRIZZLE, "0049_claim_machine_written_asset_prose.sql"), "utf8");

  it("claims the camelCase field names the code actually stores", () => {
    // `ai_suggested_fields` holds Drizzle property names ("styleNotes"), not
    // column names ("style_notes"); getting this wrong would make the backfill
    // invisible to resolveNarrativeUpdates.
    expect(sql).toContain("ARRAY['description']::text[]");
    expect(sql).toContain("ARRAY['styleNotes']::text[]");
    expect(sql).not.toContain("ARRAY['style_notes']");
  });

  it("only claims rows that were actually analyzed and hold something", () => {
    expect(sql).toContain('"ai_analyzed_at" IS NOT NULL');
    expect(sql).toContain('COALESCE(BTRIM("description"), \'\') <> \'\'');
    expect(sql).toContain('COALESCE(BTRIM("style_notes"), \'\') <> \'\'');
  });

  it("is idempotent, so a second run is a no-op", () => {
    expect(sql).toContain("NOT ('description' = ANY(");
    expect(sql).toContain("NOT ('styleNotes' = ANY(");
  });

  it("survives a NULL array rather than erasing it", () => {
    // The column is nullable with a [] default; `NULL || ARRAY[...]` is NULL.
    const updates = sql.split("--> statement-breakpoint");
    expect(updates).toHaveLength(2);
    for (const stmt of updates) {
      expect(stmt).toContain('COALESCE("ai_suggested_fields", ARRAY[]::text[])');
    }
  });
});
