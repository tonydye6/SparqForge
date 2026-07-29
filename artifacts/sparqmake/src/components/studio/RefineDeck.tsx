import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { RegionEditor } from "@/components/studio/RegionEditor";

/**
 * Stage 03 · Image · Refine.
 *
 * Spec: `22_IMPLEMENTATION_PLAN.md` Phase 4 item 3 ("Refine as the deck with
 * per-slot history"), plus `20_SPEC_00_PRINCIPLES.md` §1.2 and §1.3.
 *
 * §1.2: Explore and Refine are two modes of ONE stage, not two stages. That is
 * why the mode lives on the stage row and this component renders in the same
 * slot as the Explore grid rather than becoming a sixth node on the spine.
 *
 * The deck is the history of one slot. Every take ever made for it stays on the
 * record, newest first, and restoring an earlier one changes which take is
 * current without deleting the ones after it. Restoring is not undoing: §1.3
 * says dependency is what a stage actually consumed, so what matters downstream
 * is which take is current, not which was made last.
 */

export interface StageTake {
  id: string;
  slotKey: string;
  takeIndex: number;
  origin: string;
  payload: unknown;
  isCurrent: boolean;
}

interface TakePayload {
  imageUrl?: string;
  directive?: string;
  axisA?: { name: string; label: string };
  axisB?: { name: string; label: string };
  offBrief?: { reason: string } | null;
}

interface RefineDeckProps {
  creativeId: string;
  stageId: string;
  /** The Explore slot being refined. */
  slotKey: string;
  /** Every take on this stage. The deck filters to its own slot. */
  takes: StageTake[];
  locked: boolean;
  onChanged: () => void;
}

const payloadOf = (t: StageTake): TakePayload =>
  t.payload && typeof t.payload === "object" ? (t.payload as TakePayload) : {};

export function RefineDeck({
  creativeId,
  stageId,
  slotKey,
  takes,
  locked,
  onChanged,
}: RefineDeckProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Newest first: the deck reads as a stack, most recent on top.
  const history = takes
    .filter((t) => t.slotKey === slotKey)
    .sort((a, b) => b.takeIndex - a.takeIndex);
  const current = history.find((t) => t.isCurrent) ?? history[0] ?? null;
  const currentPayload = current ? payloadOf(current) : {};

  async function post(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(url, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? "That did not save.");
        return false;
      }
      onChanged();
      return true;
    } catch {
      setError("That could not be reached.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const backToExplore = () =>
    void post(`/api/creatives/${creativeId}/stages/${stageId}/image-mode`, { mode: "explore" });

  const restore = (takeId: string) =>
    void post(`/api/creatives/${creativeId}/stages/${stageId}/takes/${takeId}/current`);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-start gap-3">
        <button
          onClick={backToExplore}
          disabled={busy || locked}
          className="mt-0.5 flex items-center gap-1 rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
        >
          <ArrowLeft size={9} />
          Back to the spread
        </button>
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
            Stage 03 · Image · Refine
          </p>
          <h2 className="font-display text-xl tracking-wide text-foreground">
            {currentPayload.axisA?.label && currentPayload.axisB?.label
              ? `${currentPayload.axisA.label} · ${currentPayload.axisB.label}`
              : "This take"}
          </h2>
        </div>
      </div>

      {error && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-rebel-pink">
          {error}
        </p>
      )}

      {history.length === 0 ? (
        <p className="text-[12.5px] text-dim">
          This slot has no takes yet, so there is nothing to refine. Go back to the spread and run it.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            {currentPayload.imageUrl ? (
              /*
               * The image is the editing surface, not a preview. §1.12: instruction
               * is the only path for an image, and WHERE is the one part of that
               * instruction a person can state precisely, so it is expressed by
               * dragging rather than described in prose.
               */
              <RegionEditor
                creativeId={creativeId}
                stageId={stageId}
                slotKey={slotKey}
                imageUrl={currentPayload.imageUrl}
                locked={locked}
                onEdited={onChanged}
              />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center rounded-sm border border-border bg-card">
                <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                  This take has no image
                </span>
              </div>
            )}
            {currentPayload.directive && (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {currentPayload.directive}.
                {currentPayload.offBrief && (
                  <span className="text-foreground"> {currentPayload.offBrief.reason}</span>
                )}
              </p>
            )}
          </div>

          {/* The deck. Every take for this slot, newest first. */}
          <div className="space-y-1.5">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.11em] text-dim">
              History · {history.length}
            </p>
            {history.map((t) => {
              const p = payloadOf(t);
              const isCurrent = t.id === current?.id;
              return (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center gap-2 rounded-sm border p-1.5",
                    isCurrent ? "border-grit-teal bg-grit-teal/5" : "border-border/60",
                  )}
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-border/60">
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[8.5px] uppercase tracking-[0.06em] text-muted-foreground">
                      Take {t.takeIndex + 1}
                    </p>
                    <p className="truncate font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
                      {t.origin.replace(/_/g, " ")}
                    </p>
                  </div>
                  {isCurrent ? (
                    <span className="shrink-0 font-mono text-[8px] uppercase tracking-[0.06em] text-cyber-teal">
                      In use
                    </span>
                  ) : (
                    <button
                      onClick={() => restore(t.id)}
                      disabled={busy || locked}
                      className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
                    >
                      Use
                    </button>
                  )}
                </div>
              );
            })}
            <p className="pt-1 text-[10.5px] leading-relaxed text-dim">
              Nothing here is deleted. Putting an earlier take back in use changes what the later stages
              read, and leaves the rest of the history where it is.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
