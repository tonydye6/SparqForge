/**
 * Phase 8 item 3 · the conclusions, above the numbers.
 *
 * The metrics on this page have always been able to tell you WHAT happened.
 * Nothing in the app has ever been able to tell you what to DO about it, which
 * is why doc 22 asks for "small metrics table, large conclusions": the table is
 * the evidence, the conclusion is the product.
 *
 * Every card states three things, in this order, because doc 24 §8's test is
 * whether a change makes the collaboration more visible:
 *   the finding · what it rests on · **what pressing Apply would change**
 *
 * That third line is the one that matters. An Apply button whose effect you
 * have to guess at is the slot machine again, one level up.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface Evidence {
  n: number;
  metric: string;
  effectSize: number;
  entryIds: string[];
}

interface AppliesTo {
  table: string;
  field: string;
  value: unknown;
}

export interface Conclusion {
  id: string;
  conclusionKey: string;
  kind: "persona" | "composition" | "window" | "disagreement";
  statement: string;
  evidence: Evidence;
  confidence: "low" | "medium" | "high";
  status: "proposed" | "applied" | "dismissed";
  appliesTo: AppliesTo | null;
  appliedAt: string | null;
  dismissedAt: string | null;
}

const KIND_LABEL: Record<Conclusion["kind"], string> = {
  persona: "Director",
  composition: "Composition",
  window: "Posting time",
  disagreement: "Your judgement",
};

const CONFIDENCE_STYLE: Record<Conclusion["confidence"], string> = {
  high: "text-cyber-teal border-grit-teal/40",
  medium: "text-victory-gold border-victory-gold/40",
  low: "text-dim border-border/50",
};

const DAY_PART_LABEL: Record<string, string> = {
  morning: "mornings",
  midday: "midday",
  afternoon: "afternoons",
  evening: "evenings",
  night: "late night",
};

function hourRange(hours: number[]): string {
  if (hours.length === 0) return "";
  const pad = (h: number): string => `${String(h).padStart(2, "0")}:00`;
  return `${pad(hours[0])} to ${pad(hours[hours.length - 1])}`;
}

/**
 * The consequence, in the words of the thing that would change.
 *
 * Reads the SAME `appliesTo` the server will execute, so the sentence on the
 * card and the write it performs cannot drift. An unrecognised target says so
 * plainly rather than rendering a confident blank.
 */
function describeWrite(applies: AppliesTo | null): string | null {
  if (!applies) return null;

  if (applies.table === "brand_schedule_profiles") {
    const v = applies.value as { platform?: string; hours?: number[]; dayPart?: string };
    const part = DAY_PART_LABEL[v?.dayPart ?? ""] ?? v?.dayPart ?? "that window";
    const range = Array.isArray(v?.hours) ? hourRange(v.hours) : "";
    return `Marks ${part}${range ? ` (${range})` : ""} as a preferred posting window for ` +
      `${v?.platform ?? "this channel"}, every day. Smart scheduling reads those slots.`;
  }
  if (applies.table === "brands" && applies.field === "defaultPersonaId") {
    return "Makes this director the brand's default, so a new spread starts with them " +
      "instead of the house style.";
  }
  if (applies.table === "brands" && applies.field === "compositionRules") {
    const rule = (applies.value as { rule?: string } | null)?.rule;
    return `Adds "${rule ?? "this rule"}" to the brand contract, which is sent with every ` +
      "generation from now on.";
  }
  return `Writes ${applies.table}.${applies.field}.`;
}

function evidenceLine(c: Conclusion): string {
  const posts = `${c.evidence.n} post${c.evidence.n === 1 ? "" : "s"}`;
  const effect = `${c.evidence.effectSize}x ${c.evidence.metric}`;
  return `${posts} · ${effect} · ${c.confidence} confidence`;
}

export function ConclusionsPanel({ brandId }: { brandId: string }) {
  const [proposed, setProposed] = useState<Conclusion[]>([]);
  const [decided, setDecided] = useState<Conclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showDecided, setShowDecided] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/brands/${brandId}/conclusions`);
      if (!resp.ok) throw new Error(`The conclusions could not be loaded (${resp.status}).`);
      const data = await resp.json();
      setProposed(data.proposed ?? []);
      setDecided(data.decided ?? []);
    } catch (err) {
      // Stated, not swallowed. An API failure that renders as "nothing found"
      // is the failure doc 17 called out on all five of these pages.
      setError(err instanceof Error ? err.message : "The conclusions could not be loaded.");
    }
    setLoading(false);
  }, [brandId]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (c: Conclusion, action: "apply" | "dismiss"): Promise<void> => {
    setBusyId(c.id);
    setError(null);
    setNote(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/conclusions/${c.id}/${action}`, { method: "POST" });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? `That did not go through (${resp.status}).`);
      setNote(body.summary ?? "Dismissed. It will not be proposed again.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    }
    setBusyId(null);
  };

  const refresh = async (): Promise<void> => {
    setBusyId("refresh");
    setError(null);
    setNote(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/brands/${brandId}/conclusions/refresh`, { method: "POST" });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? "The check could not run.");
      setNote(
        body.derived === 0
          ? "Nothing to report. Not enough published posts show a difference big enough to act on."
          : `Checked ${body.derived} finding${body.derived === 1 ? "" : "s"} against the latest numbers.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The check could not run.");
    }
    setBusyId(null);
  };

  return (
    <section className="mb-5 sm:mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.11em] text-dim">
            What these posts have taught the app
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Nothing here changes anything until you apply it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busyId !== null}
          className="shrink-0 rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate disabled:opacity-50"
        >
          {busyId === "refresh" ? "Checking" : "Check again"}
        </button>
      </div>

      {error && (
        <p className="mb-2 rounded-sm border border-destructive/40 bg-raised px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="mb-2 rounded-sm border border-grit-teal/40 bg-raised px-2.5 py-1.5 text-[11px] leading-relaxed text-cyber-teal">
          {note}
        </p>
      )}

      {loading && proposed.length === 0 && (
        <p className="text-[11px] text-dim">Reading the published posts…</p>
      )}

      {!loading && proposed.length === 0 && (
        /*
         * Says WHY there is nothing, not just that there is nothing. "No
         * conclusions yet" on a page showing 30 tracked posts reads as broken;
         * the real reason is that a difference has to be big enough to act on.
         */
        <p className="rounded-sm border border-border/50 bg-raised px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Nothing to act on yet. A finding is only reported when a group of at least three posts
          beats the rest by a wide enough margin to be worth changing something over.
        </p>
      )}

      <div className="space-y-2">
        {proposed.map(c => {
          const write = describeWrite(c.appliesTo);
          return (
            <article key={c.id} className="rounded-sm border border-grit-teal/40 bg-raised px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground">
                  {KIND_LABEL[c.kind]}
                </span>
                <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] ${CONFIDENCE_STYLE[c.confidence]}`}>
                  {c.confidence}
                </span>
              </div>

              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">{c.statement}</p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.09em] text-grit-teal">
                {evidenceLine(c)}
              </p>

              {write ? (
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  <span className="text-dim">Applying this: </span>{write}
                </p>
              ) : (
                /*
                 * The disagreement card. It has nothing to write, and saying so
                 * out loud is the honest version — the thing to adjust is a
                 * habit, and there is no setting for that.
                 */
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  <span className="text-dim">Nothing to apply. </span>
                  There is no setting for this one. It is about how the work is being approved.
                </p>
              )}

              <div className="mt-2 flex gap-2">
                {c.appliesTo && (
                  <button
                    type="button"
                    onClick={() => void decide(c, "apply")}
                    disabled={busyId !== null}
                    className="rounded-sm bg-primary px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
                  >
                    {busyId === c.id ? "Applying" : "Apply"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void decide(c, "dismiss")}
                  disabled={busyId !== null}
                  className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate disabled:opacity-50"
                >
                  {c.appliesTo ? "Dismiss" : "Noted"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {decided.length > 0 && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowDecided(v => !v)}
            className="font-mono text-[9px] uppercase tracking-[0.09em] text-dim hover:text-muted-foreground"
          >
            {showDecided ? "Hide" : "Show"} what you already decided ({decided.length})
          </button>
          {showDecided && (
            <div className="mt-1.5 space-y-1">
              {decided.map(c => (
                <div key={c.id} className="rounded-sm border border-border/50 bg-raised px-2.5 py-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{c.statement}</p>
                    <span className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.09em] ${c.status === "applied" ? "text-cyber-teal" : "text-dim"}`}>
                      {c.status}
                    </span>
                  </div>
                  {/*
                    * The date is the attribution doc 22 asks for: an applied
                    * conclusion changed what the next session proposes, and this
                    * is where you find out when that started being true.
                    */}
                  <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.09em] text-dim">
                    {c.appliedAt
                      ? `Applied ${new Date(c.appliedAt).toLocaleDateString()}`
                      : c.dismissedAt
                        ? `Dismissed ${new Date(c.dismissedAt).toLocaleDateString()}`
                        : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
