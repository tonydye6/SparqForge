import { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";

/**
 * Stage 02 · Direction.
 *
 * Spec: `20_SPEC_00_PRINCIPLES.md` §1.10 and §1.17, and the Studio artifact
 * screen 05.
 *
 * §1.10 is the rule this screen exists to make visible: **the designer decides
 * how it is composed, the brand decides what it is made of.** A persona can
 * never overrule palette, voice, mark or sound. So every card states what it
 * governs, and the footer states what none of them can touch. Without that, a
 * spread of directors reads like a spread of brands.
 *
 * §1.17 shows up twice: a hit rate is never shown without the sample it came
 * from, and a locked brand default is labelled as a human decision so the
 * ranking cannot quietly overrule it.
 *
 * Direction records `consumedFrom: [briefStageId]` and does NOT auto-lock. That
 * combination is deliberate. Consuming the brief means a rewritten brief marks
 * this stage stale, which is correct: a different brief may deserve a different
 * director. Not auto-locking means the spine can say so. Marking stale never
 * overwrites a choice, and the lock control in the spine header is there for
 * anyone who wants this pinned regardless.
 */

interface DirectionStageProps {
  creativeId: string;
  stageId: string;
  /** The brief stage, so this stage can record what it consumed. */
  briefStageId: string | null;
  locked: boolean;
  onSaved: () => void;
}

interface HitRate {
  rate: number | null;
  n: number;
  positive: number;
  negative: number;
}

interface SpreadCard {
  id: string;
  kind: "persona" | "house";
  name: string;
  description: string;
  governs: string[];
  referenceCount: number;
  hitRate: HitRate;
  isBrandDefault: boolean;
}

interface SpreadResponse {
  spread: SpreadCard[];
  brandOwned: string[];
  brandId: string;
  brandName: string | null;
  defaultPersonaId: string | null;
  judgedSignalCount: number;
}

export function DirectionStage({
  creativeId,
  stageId,
  briefStageId,
  locked,
  onSaved,
}: DirectionStageProps) {
  const [data, setData] = useState<SpreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lockingDefault, setLockingDefault] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/direction-spread`);
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as SpreadResponse;
      setData(json);
      // Preselect the brand default so the common case is one click, not two.
      setSelected((prev) => prev ?? json.spread.find((c) => c.isBrandDefault)?.id ?? null);
    } catch {
      setError("The designer spread could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [creativeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!selected || locked) return;
    setSaving(true);
    try {
      const card = data?.spread.find((c) => c.id === selected);
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/takes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotKey: "direction",
          // A deliberate pick, not typed prose, so it does not auto-lock and the
          // spine can mark it stale if the brief is rewritten.
          origin: "swapped_in",
          payload: {
            directorId: selected,
            kind: card?.kind ?? "persona",
            name: card?.name ?? null,
            // Recorded so a later reader knows what the ranking looked like when
            // the choice was made, rather than re-deriving a number that has
            // since moved.
            hitRateAtChoice: card?.hitRate ?? null,
          },
          // Direction consumes the brief. Recorded, never inferred.
          consumedFrom: briefStageId ? [briefStageId] : [],
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
      } else {
        setError("That choice could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleBrandDefault(card: SpreadCard) {
    if (!data || locked) return;
    setLockingDefault(true);
    try {
      const clearing = card.isBrandDefault;
      const res = await apiFetch(`/api/brands/${data.brandId}/default-persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: clearing ? null : card.kind === "house" ? null : card.id }),
      });
      if (res.ok) await load();
      else setError("The brand default could not be changed.");
    } finally {
      setLockingDefault(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-[12.5px] text-dim">Reading this brand's record.</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 p-6">
        <p className="text-[12.5px] text-rebel-pink">{error}</p>
        <button
          onClick={() => void load()}
          className="rounded-sm border border-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
          Stage 02 · Direction
        </p>
        <h2 className="font-display text-xl tracking-wide text-foreground">Who directs this one</h2>
        <p className="max-w-[76ch] text-[12.5px] leading-relaxed text-muted-foreground">
          A director decides how the work is composed. It never decides what the work is made of, so
          picking one cannot take this off brand. House style is the baseline the others are a departure
          from.
        </p>
      </div>

      {error && (
        <p className="rounded-sm border border-victory-gold/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-victory-gold">
          {error}
        </p>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {data.spread.map((card) => {
          const isSelected = selected === card.id;
          return (
            <div
              key={card.id}
              className={cn(
                "rounded-sm border bg-card p-3.5 transition-colors",
                isSelected ? "border-grit-teal" : "border-border/60",
              )}
            >
              <button
                onClick={() => !locked && setSelected(card.id)}
                disabled={locked}
                className="block w-full text-left"
                aria-pressed={isSelected}
              >
                <div className="flex items-start gap-2">
                  <p
                    className={cn(
                      "text-[13.5px] font-medium",
                      isSelected ? "text-cyber-teal" : "text-foreground",
                    )}
                  >
                    {card.name}
                  </p>
                  {card.kind === "house" && (
                    <span className="mt-0.5 rounded-sm border border-border px-1 py-px font-mono text-[7.5px] uppercase tracking-[0.06em] text-dim">
                      Baseline
                    </span>
                  )}
                  {card.isBrandDefault && (
                    <span className="mt-0.5 flex items-center gap-1 rounded-sm border border-victory-gold/40 px-1 py-px font-mono text-[7.5px] uppercase tracking-[0.06em] text-victory-gold">
                      <Lock size={7} />
                      Brand default
                    </span>
                  )}
                </div>

                {card.description && (
                  <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{card.description}</p>
                )}

                <div className="mt-2 space-y-1">
                  {/* A rate is never shown without the sample behind it. */}
                  <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                    {card.hitRate.rate === null ? (
                      card.hitRate.n === 0 ? (
                        <>No signal yet</>
                      ) : (
                        <>
                          Not enough signal yet ·{" "}
                          <span data-numeric>{card.hitRate.n}</span> judged
                        </>
                      )
                    ) : (
                      <>
                        <span className="text-cyber-teal" data-numeric>
                          {Math.round(card.hitRate.rate * 100)}%
                        </span>{" "}
                        kept, from <span data-numeric>{card.hitRate.n}</span> judged
                      </>
                    )}
                  </p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                    {card.referenceCount === 0
                      ? "No references"
                      : `${card.referenceCount} reference${card.referenceCount === 1 ? "" : "s"}`}
                  </p>
                  {card.governs.length > 0 && (
                    <p className="text-[10.5px] leading-snug text-dim">
                      Directs {card.governs.join(", ").toLowerCase()}
                    </p>
                  )}
                </div>
              </button>

              <button
                onClick={() => void toggleBrandDefault(card)}
                disabled={locked || lockingDefault}
                className="mt-2.5 rounded-sm border border-border px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
              >
                {card.isBrandDefault ? "Unlock brand default" : "Lock as brand default"}
              </button>
            </div>
          );
        })}
      </div>

      {/* §1.10, said out loud. */}
      <p className="rounded-sm border border-border/60 bg-card px-3.5 py-2.5 text-[11px] leading-relaxed text-dim">
        No director changes {data.brandOwned.join(", ").toLowerCase()}. Those stay with{" "}
        {data.brandName ?? "the brand"} whichever card you pick, which is what lets one director work
        across four brands without flattening them into one.
      </p>

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border/60 bg-card px-3.5 py-2.5">
        <p className="text-[11.5px] text-muted-foreground">
          {data.judgedSignalCount === 0 ? (
            <>
              No judged work for this brand yet, so the order is alphabetical rather than earned.
            </>
          ) : (
            <>
              Ranked on <span className="font-medium text-foreground" data-numeric>{data.judgedSignalCount}</span>{" "}
              judged {data.judgedSignalCount === 1 ? "signal" : "signals"} from this brand's own history.
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {saved && (
            <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-cyber-teal">
              Saved
            </span>
          )}
          <button
            onClick={() => void save()}
            disabled={!selected || saving || locked}
            className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate disabled:opacity-40"
          >
            {locked ? "Locked" : saving ? "Saving" : "Use this director"}
          </button>
        </div>
      </div>

      {!briefStageId && (
        <p className="text-[11px] leading-relaxed text-dim">
          This creative has no brief stage, so nothing will be recorded as consumed and a rewritten brief
          will not mark this stale.
        </p>
      )}
    </div>
  );
}
