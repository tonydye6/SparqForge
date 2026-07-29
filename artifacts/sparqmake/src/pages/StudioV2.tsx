import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import { useGetCreatives } from "@workspace/api-client-react";
import { Lock, Unlock } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { StageSpine, ReopenBar, type SpineStage, type SpineEdge, type SpineStatus } from "@/components/studio/StageSpine";
import { BriefStage } from "@/components/studio/BriefStage";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Studio v2. The shell every stage lives inside.
 *
 * Spec: SparqMake Sandbox/22_IMPLEMENTATION_PLAN.md Phase 4, and the Studio
 * artifact, screens 01 to 12.
 *
 * Deliberately at its own route rather than replacing the working Studio. The
 * v2 Studio reaches parity stage by stage across Phase 4, and taking the
 * existing one away before then would remove a working tool and leave a
 * half-finished one in its place. Legacy retires when this is genuinely better,
 * not when it is merely newer.
 *
 * The shell's job is the chrome that never changes between stages:
 *
 *   the spine across the top          · addressable history
 *   the locked brand contract         · non-negotiable, no remove control
 *   the Material rail                 · what the director actually reached for
 *   the "Why this" strip              · always says something, never a tooltip
 *   the composer                      · one input, carrying the selection
 *
 * Individual stages render into the middle. That split is why adding stage 02
 * later does not touch any of this.
 */

interface StageRow {
  id: string;
  stageNumber: number;
  stageKind: "brief" | "direction" | "asset" | "copy" | "crops";
  mode: "explore" | "refine";
  status: SpineStatus;
  consumedFrom: string[];
  supersededReason?: string | null;
}

interface SpineResponse {
  stages: StageRow[];
  takes: Record<string, Array<{ id: string; slotKey: string; takeIndex: number; origin: string; payload: unknown; isCurrent: boolean }>>;
  edges: SpineEdge[];
}

interface ReopenPreview {
  plan: {
    stale: Array<{ id: string; reason: string }>;
    protected: Array<{ id: string; why: string }>;
    isIsolated: boolean;
    targetLocked: boolean;
    alreadyStale: string[];
  };
  summary: string;
}

const STAGE_LABELS: Record<StageRow["stageKind"], string> = {
  brief: "Brief",
  direction: "Direction",
  asset: "Image",
  copy: "Copy",
  crops: "Channel crops",
};

/** One line of what a stage decided, or what it is waiting for. */
function summarise(stage: StageRow, takes: SpineResponse["takes"]): string {
  if (stage.status === "stale" && stage.supersededReason) return stage.supersededReason;
  const mine = takes[stage.id] ?? [];
  const current = mine.find((t) => t.isCurrent);
  if (current && typeof current.payload === "string" && current.payload.length > 0) return current.payload;
  if (current && current.payload && typeof current.payload === "object") {
    const p = current.payload as Record<string, unknown>;
    if (typeof p.summary === "string") return p.summary;
  }
  if (mine.length > 0) return `${mine.length} ${mine.length === 1 ? "take" : "takes"}`;
  return "Not made yet";
}

export default function StudioV2() {
  const [searchParams, setSearchParams] = useSearchParams();
  const creativeId = searchParams.get("creative");
  const { data: creatives } = useGetCreatives();

  const [spine, setSpine] = useState<SpineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReopenPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSpine = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${id}/stages`);
      if (!res.ok) throw new Error(`Failed to load stages (${res.status})`);
      const body: SpineResponse = await res.json();
      setSpine(body);
      // Land on the first stage that is not finished, which is where the work
      // actually is, rather than always dropping people on stage 01.
      const next = body.stages.find((s) => s.status !== "done" && s.status !== "locked") ?? body.stages[0];
      setActiveStageId((prev) => prev ?? next?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (creativeId) void loadSpine(creativeId);
  }, [creativeId, loadSpine]);

  const stages: SpineStage[] = useMemo(
    () =>
      (spine?.stages ?? []).map((s) => ({
        id: s.id,
        stageNumber: s.stageNumber,
        label: STAGE_LABELS[s.stageKind],
        summary: summarise(s, spine?.takes ?? {}),
        status: s.status,
      })),
    [spine],
  );

  const activeStage = spine?.stages.find((s) => s.id === activeStageId) ?? null;

  /**
   * Opening a stage previews the consequences before anything changes. The
   * preview is a safe GET, so this runs freely on navigation; nothing is marked
   * stale until the user chooses it in the bar below the spine.
   */
  const openStage = useCallback(
    async (stageId: string) => {
      setActiveStageId(stageId);
      setPreview(null);
      if (!creativeId) return;
      const stage = spine?.stages.find((s) => s.id === stageId);
      // Only worth previewing for a stage that has actually decided something.
      if (!stage || stage.status === "empty") return;
      try {
        const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/reopen-preview`);
        if (!res.ok) return;
        const body: ReopenPreview = await res.json();
        if (!body.plan.isIsolated) setPreview(body);
      } catch {
        // A failed preview must not block navigation. Worst case the user does
        // not see the offer, which is strictly better than being stuck.
      }
    },
    [creativeId, spine],
  );

  const applyReopen = useCallback(
    async (markDownstreamStale: boolean) => {
      if (!creativeId || !activeStageId) return;
      try {
        await apiFetch(`/api/creatives/${creativeId}/stages/${activeStageId}/reopen`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markDownstreamStale }),
        });
      } finally {
        setPreview(null);
        await loadSpine(creativeId);
      }
    },
    [creativeId, activeStageId, loadSpine],
  );

  const toggleLock = useCallback(async () => {
    if (!creativeId || !activeStage) return;
    await apiFetch(`/api/creatives/${creativeId}/stages/${activeStage.id}/lock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: activeStage.status !== "locked" }),
    });
    await loadSpine(creativeId);
  }, [creativeId, activeStage, loadSpine]);

  // ---------------------------------------------------------------- picker
  if (!creativeId) {
    const recent = (creatives?.data ?? []).slice(0, 12);
    return (
      <div className="mx-auto max-w-3xl space-y-5 p-8">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
            Studio v2 · in progress
          </p>
          <h1 className="font-display text-2xl tracking-wide text-foreground">Pick something to open</h1>
          <p className="max-w-[76ch] text-[12.5px] leading-relaxed text-muted-foreground">
            This is the v2 Studio being built stage by stage. It runs beside the existing Studio rather than
            replacing it, so nothing you rely on has moved. Stage 01 is live; the rest arrive through Phase 4.
          </p>
        </div>
        <div className="space-y-1.5">
          {recent.length === 0 && (
            <p className="text-[12.5px] text-dim">No creatives yet. Make one in the Studio first.</p>
          )}
          {recent.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("creative", c.id);
                setSearchParams(next);
              }}
              className="block w-full rounded-sm border border-border/60 bg-card px-3 py-2 text-left transition-colors hover:border-grit-teal/50"
            >
              <p className="truncate text-[13px] text-foreground">{c.name}</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-dim">{c.status}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------- shell
  return (
    <div className="flex h-full min-h-0 flex-col">
      {loading && !spine && (
        <div className="space-y-2 p-4">
          <Skeleton className="h-14 w-full rounded-sm" />
          <Skeleton className="h-64 w-full rounded-sm" />
        </div>
      )}

      {error && (
        <div className="m-4 rounded-sm border border-rebel-pink/40 bg-rebel-pink/10 px-4 py-3">
          <p className="text-[12.5px] text-foreground">{error}</p>
          <button
            onClick={() => creativeId && loadSpine(creativeId)}
            className="mt-2 rounded-sm border border-border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate"
          >
            Try again
          </button>
        </div>
      )}

      {spine && (
        <>
          <StageSpine
            stages={stages}
            edges={spine.edges}
            activeStageId={activeStageId ?? undefined}
            onOpenStage={(id) => void openStage(id)}
          />

          {preview && (
            <ReopenBar
              summary={preview.summary}
              staleCount={preview.plan.stale.length - preview.plan.alreadyStale.length}
              onRerun={() => void applyReopen(true)}
              onKeep={() => void applyReopen(false)}
            />
          )}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-dim">
                  Stage {String(activeStage?.stageNumber ?? 0).padStart(2, "0")} ·{" "}
                  {activeStage ? STAGE_LABELS[activeStage.stageKind] : ""}
                </span>
                {activeStage && (
                  <button
                    onClick={() => void toggleLock()}
                    title={
                      activeStage.status === "locked"
                        ? "Unlock, so this stage rejoins the normal flow"
                        : "Lock, making this an input to every other stage"
                    }
                    className={cn(
                      "ml-auto flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] hover-elevate",
                      activeStage.status === "locked"
                        ? "border-grit-teal text-cyber-teal"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {activeStage.status === "locked" ? <Lock size={9} /> : <Unlock size={9} />}
                    {activeStage.status === "locked" ? "Locked" : "Lock"}
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {activeStage?.stageKind === "brief" ? (
                  <BriefStage
                    creativeId={creativeId}
                    brandId={
                      (creatives?.data ?? []).find((c) => c.id === creativeId)?.brandId ?? null
                    }
                    stageId={activeStage.id}
                    locked={activeStage.status === "locked"}
                    onSaved={() => void loadSpine(creativeId)}
                  />
                ) : (
                  <div className="p-8">
                    <p className="max-w-[70ch] text-[12.5px] leading-relaxed text-muted-foreground">
                      {activeStage ? STAGE_LABELS[activeStage.stageKind] : "This stage"} arrives later in Phase 4.
                      The spine, the dependency engine and the lock behaviour above are already live, so you can
                      reopen a stage and watch what it marks stale.
                    </p>
                  </div>
                )}
              </div>

              {/* Why this. Always says something, per the Ableton Info View idea. */}
              <div className="flex shrink-0 items-start gap-3 border-t border-border/60 bg-card px-4 py-2.5">
                <span className="whitespace-nowrap pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.11em] text-grit-teal">
                  Why this
                </span>
                <p className="max-w-[92ch] text-[12px] leading-relaxed text-muted-foreground">
                  {activeStage?.status === "stale" && activeStage.supersededReason
                    ? `${activeStage.supersededReason}. Stale means built on something you have since reopened, not wrong.`
                    : activeStage?.status === "locked"
                      ? "This stage is locked, so it is an input to every other stage and nothing upstream can overwrite it."
                      : activeStage?.consumedFrom.length
                        ? `Built on ${activeStage.consumedFrom.length} earlier ${activeStage.consumedFrom.length === 1 ? "stage" : "stages"}. Reopening any of them will mark this stale rather than regenerating it.`
                        : "Nothing was consumed here yet, so nothing upstream can invalidate it."}
                </p>
              </div>
            </div>

            {/* The brand contract, permanently locked, and the Material rail. */}
            <aside className="flex w-[196px] shrink-0 flex-col border-l border-border/60 bg-surround">
              <div className="border-b border-border/60 bg-grit-teal/[0.05] px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Lock size={9} className="text-cyber-teal" />
                  <span className="font-display text-[13px] uppercase tracking-[0.08em] text-foreground">
                    Brand
                  </span>
                  <span className="ml-auto font-mono text-[8px] tracking-[0.07em] text-grit-teal">
                    NON-NEGOTIABLE
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-[8px] leading-relaxed tracking-[0.07em] text-dim">
                  READ FROM THE BRAND RECORD ·<br />CANNOT BE REMOVED HERE
                </p>
              </div>
              <div className="px-3 py-2.5">
                <p className="font-display text-[13px] uppercase tracking-[0.09em] text-foreground">Material</p>
                <p className="mt-0.5 text-[10px] leading-snug text-dim">
                  What the director reached for at this stage.
                </p>
              </div>
              <p className="mt-auto border-t border-border/60 px-3 py-2 font-mono text-[8.5px] leading-relaxed tracking-[0.06em] text-dim">
                Populated from stage 02 onward
              </p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
