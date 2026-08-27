import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "wouter";
import { useGetCreatives } from "@workspace/api-client-react";
import { ArrowRight, Lock, Unlock } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { StageSpine, ReopenBar, type SpineStage, type SpineEdge, type SpineStatus } from "@/components/studio/StageSpine";
import { BriefStage } from "@/components/studio/BriefStage";
import { DirectionStage } from "@/components/studio/DirectionStage";
import { ImageStage } from "@/components/studio/ImageStage";
import { CopyStage } from "@/components/studio/CopyStage";
import { CropStage } from "@/components/studio/CropStage";
import { BrandContract } from "@/components/studio/BrandContract";
import { MaterialRail } from "@/components/studio/MaterialRail";
import { ReviewBar } from "@/components/studio/ReviewBar";
import { ShipBar } from "@/components/studio/ShipBar";
import { SaveRunButton } from "@/components/studio/SavedRuns";
import { Entrance } from "@/components/studio/Entrance";
import { SmartBar } from "@/components/studio/SmartBar";
import { InfoDot } from "@/components/studio/InfoDot";
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
  brief: "Spark",
  direction: "Director",
  asset: "Media",
  copy: "Copy",
  crops: "Launch pad",
};

interface StageDecision {
  text: string;
  thumbs?: Array<{ url: string; video?: boolean }>;
}

/**
 * What a stage DECIDED, not how many tries it took (doc 41 item 16, pick A).
 *
 * "13 takes" said effort was spent; it never said what came of it. Each node
 * now carries its outcome: the brief's own words, the director's name, the
 * picked frame and clip as thumbnails, the hook once written, the framing
 * once set. Take counts survive inside the stages, where the deck shows them.
 */
function decisionFor(stage: StageRow, takes: SpineResponse["takes"]): StageDecision {
  if (stage.status === "stale" && stage.supersededReason) return { text: stage.supersededReason };
  const mine = takes[stage.id] ?? [];
  const current = (slot: string) => mine.find((t) => t.isCurrent && t.slotKey === slot);
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  switch (stage.stageKind) {
    case "brief": {
      const p = current("brief")?.payload as { line?: unknown } | undefined;
      if (typeof p?.line === "string" && p.line.trim()) return { text: `"${clip(p.line.trim(), 36)}"` };
      break;
    }
    case "direction": {
      const p = current("direction")?.payload as { name?: unknown; kind?: unknown } | undefined;
      if (p?.kind === "house") return { text: "House style" };
      if (typeof p?.name === "string" && p.name) return { text: p.name };
      break;
    }
    case "asset": {
      const sel = current("selected")?.payload as { imageUrl?: unknown } | undefined;
      const mot = current("motion")?.payload as { sourceImageUrl?: unknown; videoUrl?: unknown } | undefined;
      const thumbs: Array<{ url: string; video?: boolean }> = [];
      if (typeof sel?.imageUrl === "string") thumbs.push({ url: sel.imageUrl });
      // The clip's thumb is its source frame, because a <video> in the spine
      // would be five autoloading players for one glance.
      if (typeof mot?.videoUrl === "string" && typeof mot?.sourceImageUrl === "string") {
        thumbs.push({ url: mot.sourceImageUrl, video: true });
      }
      if (thumbs.length > 0) return { text: "", thumbs };
      const rendered = mine.filter((t) => {
        const p = t.payload as { imageUrl?: unknown } | undefined;
        return t.isCurrent && typeof p?.imageUrl === "string";
      }).length;
      if (rendered > 0) return { text: "No pick yet" };
      break;
    }
    case "copy": {
      const p = current("copy")?.payload as { hook?: unknown; base?: unknown } | undefined;
      if (typeof p?.hook === "string" && p.hook.trim()) return { text: `"${clip(p.hook.trim(), 36)}"` };
      if (typeof p?.base === "string" && p.base.trim()) return { text: clip(p.base.trim(), 36) };
      break;
    }
    case "crops": {
      const p = current("crops")?.payload as { focal?: unknown } | undefined;
      if (p?.focal && typeof p.focal === "object") return { text: "Framing set" };
      break;
    }
  }
  // History without a readable decision — the count is the honest fallback.
  if (mine.length > 0) return { text: `${mine.length} ${mine.length === 1 ? "take" : "takes"}` };
  return { text: "Not made yet" };
}

export default function StudioV2() {
  const [searchParams, setSearchParams] = useSearchParams();
  const creativeId = searchParams.get("creative");

  /*
   * The rail's rows, fetched with ?preview=1 so each carries the picked image
   * and a Studio-work count. Three identically named, pictureless drafts —
   * one finished, two dead — were indistinguishable in the old rail, and
   * legacy Co-pilot creatives (no stage takes) opened here as empty spines
   * over real session work (doc 40 P1.7). Only posts with v2 takes are shown.
   */
  const [recentRows, setRecentRows] = useState<Array<{
    id: string; name: string; status: string; previewImageUrl: string | null; updatedAt?: string; createdAt?: string; studioTakeCount: number;
  }>>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/creatives?preview=1&limit=24`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled && Array.isArray(body?.data)) setRecentRows(body.data);
      } catch {
        // The rail renders empty rather than blocking the entrance.
      }
    })();
    return () => { cancelled = true; };
  }, [creativeId]);

  /**
   * The open creative's own brand, fetched rather than looked up in the list.
   *
   * THE BUG THIS FIXES. The brand used to be read out of `useGetCreatives()`,
   * which is a cached first page. A creative made moments ago is not in it, and
   * neither is anything past the page limit, so the brand contract rendered
   * "no brand on this creative" for a post that plainly had one. Principle 1.9
   * makes that block the frame around everything, so an empty one is not a
   * cosmetic miss: it is the one panel that is never allowed to be wrong.
   */
  const [brandId, setBrandId] = useState<string | null>(null);

  const [spine, setSpine] = useState<SpineResponse | null>(null);
  /**
   * Bumped every time the spine is re-read, which is after every stage save.
   * The publishing bar watches it, so what it says a post will publish cannot
   * drift from what the stages currently hold.
   */
  const [revision, setRevision] = useState(0);
  /** Bumped when the approval state changed without a stage changing. */
  const [teamRevision, setTeamRevision] = useState(0);
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
      setRevision((n) => n + 1);
      /*
       * Land where the work actually stops — at or after the FURTHEST stage
       * that holds takes — never on an untouched stage upstream of finished
       * work. The old rule ("first stage not done") dropped a fully shipped
       * post on stage 02's director screen, because using the default director
       * writes no take and leaves 02 "empty" forever (doc 40 P1.8). A post
       * with no takes at all still starts at stage 01.
       */
      const lastIdx = (() => {
        for (let i = body.stages.length - 1; i >= 0; i--) {
          if ((body.takes[body.stages[i].id] ?? []).length > 0) return i;
        }
        return 0;
      })();
      const next =
        body.stages.find((s, i) => i >= lastIdx && s.status !== "done" && s.status !== "locked") ??
        body.stages[lastIdx] ?? body.stages[0];
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

  useEffect(() => {
    if (!creativeId) {
      setBrandId(null);
      return;
    }
    void apiFetch(`/api/creatives/${creativeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (c?.brandId) setBrandId(c.brandId); })
      .catch(() => { /* the panel shows the fetched value or nothing */ });
  }, [creativeId]);

  const stages: SpineStage[] = useMemo(
    () =>
      (spine?.stages ?? []).map((s) => {
        const decision = decisionFor(s, spine?.takes ?? {});
        return {
          id: s.id,
          stageNumber: s.stageNumber,
          label: STAGE_LABELS[s.stageKind],
          summary: decision.text,
          thumbs: decision.thumbs,
          status: s.status,
        };
      }),
    [spine],
  );

  const activeStage = spine?.stages.find((s) => s.id === activeStageId) ?? null;

  /*
   * The one forward button (doc 41 items 7-11: five sightings of the same
   * missing affordance). Every stage header ends with the same control in the
   * same place: the next stage by display order, named. On the last stage the
   * forward IS publishing, so the button opens the publish panel.
   */
  const nextStage = useMemo(() => {
    if (!spine || !activeStageId) return null;
    const i = spine.stages.findIndex((s) => s.id === activeStageId);
    return i >= 0 ? spine.stages[i + 1] ?? null : null;
  }, [spine, activeStageId]);

  /*
   * Item 13, Tony's pick B: NO standing bottom bar. The publish state lives as
   * a chip in the stage header; clicking it (or the last stage's Finish) opens
   * a panel holding the full publishing and review surfaces. The chip keeps
   * its own tiny read of ship-preview so it can be honest without mounting
   * the whole bar, and re-reads on the same counters the bar always did.
   */
  const [publishOpen, setPublishOpen] = useState(false);
  const [pub, setPub] = useState<{ blocked: number; variants: number; inSync: boolean; updates: boolean } | null>(null);
  useEffect(() => {
    if (!creativeId) { setPub(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/creatives/${creativeId}/ship-preview`);
        if (!res.ok || cancelled) return;
        const b = await res.json() as { blocked?: string[]; variants?: Array<{ updates?: boolean }>; inSync?: boolean };
        if (cancelled) return;
        setPub({
          blocked: (b.blocked ?? []).length,
          variants: (b.variants ?? []).length,
          inSync: Boolean(b.inSync),
          updates: (b.variants ?? []).some((v) => v.updates),
        });
      } catch { /* no chip is better than a guessed chip */ }
    })();
    return () => { cancelled = true; };
  }, [creativeId, revision, teamRevision]);

  /** The Why-this sentence, now carried by an InfoDot on the stage title. */
  const whyThis = activeStage?.status === "stale" && activeStage.supersededReason
    ? `${activeStage.supersededReason}. Stale means built on something you have since reopened, not wrong.`
    : activeStage?.status === "locked"
      ? "This stage is locked, so it is an input to every other stage and nothing upstream can overwrite it."
      : activeStage?.consumedFrom.length
        ? `Built on ${activeStage.consumedFrom.length} earlier ${activeStage.consumedFrom.length === 1 ? "stage" : "stages"}. Reopening any of them will mark this stale rather than regenerating it.`
        : "Nothing was consumed here yet, so nothing upstream can invalidate it.";

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

  // ------------------------------------------------------------- entrance
  if (!creativeId) {
    const open = (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("creative", id);
      setSearchParams(next);
    };
    /*
     * /studio-v2 IS stage 01. The picker this replaced could only open work
     * that already existed, and its predecessor forced people INTO existing
     * work — both failure modes, one screen. The entrance starts from a typed
     * line, and the rail keeps every previous effort one click away.
     */
    return (
      <Entrance
        recent={recentRows
          .filter((c) => c.studioTakeCount > 0)
          .slice(0, 12)
          .map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            previewImageUrl: c.previewImageUrl,
            at: c.updatedAt ?? c.createdAt ?? null,
          }))}
        onOpen={open}
      />
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
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover-elevate"
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

          <div className="relative flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-3 px-5 py-2.5">
                {/* The stage name is the TITLE of this screen — the display
                    voice at a real size, not a mono annotation. */}
                <span className="flex items-baseline gap-2">
                  <span className="ui-data text-[11px] text-dim">
                    {String(activeStage?.stageNumber ?? 0).padStart(2, "0")}
                  </span>
                  <span className="font-display text-[17px] font-extrabold uppercase leading-none text-foreground" style={{ letterSpacing: "-0.01em" }}>
                    {activeStage ? STAGE_LABELS[activeStage.stageKind] : ""}
                  </span>
                  {/* Why-this, off the floor and onto the title (13B). */}
                  {activeStage && <InfoDot text={whyThis} />}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {/*
                    The publish state as a chip (13B): a dot and two words where
                    three standing rows used to be. Clicking it opens the full
                    publishing + review panel over the rail.
                  */}
                  {pub && (
                    <button
                      onClick={() => setPublishOpen((v) => !v)}
                      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover-elevate"
                      data-testid="button-publish-chip"
                      aria-expanded={publishOpen}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          pub.blocked > 0 ? "bg-rebel-pink" : pub.inSync ? "bg-cyber-teal" : "bg-victory-gold",
                        )}
                      />
                      {pub.blocked > 0
                        ? "Cannot publish"
                        : pub.inSync
                          ? `Publishable · ${pub.variants}`
                          : pub.updates
                            ? "Update ready"
                            : "Ready to ship"}
                    </button>
                  )}
                  {activeStage && (
                    <button
                      onClick={() => void toggleLock()}
                      title={
                        activeStage.status === "locked"
                          ? "Unlock, so this stage rejoins the normal flow"
                          : "Lock, making this an input to every other stage"
                      }
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium hover-elevate",
                        activeStage.status === "locked"
                          ? "text-cyber-teal"
                          : "text-muted-foreground",
                      )}
                    >
                      {activeStage.status === "locked" ? <Lock size={12} /> : <Unlock size={12} />}
                      {activeStage.status === "locked" ? "Locked" : "Lock"}
                    </button>
                  )}
                  {/*
                    Beside Lock, because locking is what decides what a saved run
                    carries. Putting the two controls anywhere else would leave
                    the connection between them to be guessed.
                  */}
                  <SaveRunButton
                    creativeId={creativeId}
                    brandId={brandId}
                    stages={spine.stages}
                  />
                  {activeStage && (nextStage ? (
                    <button
                      onClick={() => void openStage(nextStage.id)}
                      className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover-elevate"
                      data-testid="button-stage-continue"
                    >
                      Continue {"·"} {STAGE_LABELS[nextStage.stageKind]}
                      <ArrowRight size={13} />
                    </button>
                  ) : (
                    <button
                      onClick={() => setPublishOpen(true)}
                      className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[12.5px] font-semibold text-primary-foreground hover-elevate"
                      data-testid="button-stage-continue"
                    >
                      Finish {"·"} make it publishable
                      <ArrowRight size={13} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {activeStage?.stageKind === "brief" ? (
                  <BriefStage
                    creativeId={creativeId}
                    brandId={brandId}
                    stageId={activeStage.id}
                    locked={activeStage.status === "locked"}
                    onSaved={() => void loadSpine(creativeId)}
                  />
                ) : activeStage?.stageKind === "direction" ? (
                  <DirectionStage
                    creativeId={creativeId}
                    stageId={activeStage.id}
                    // Direction consumes the brief, so it needs the brief's id to
                    // record that edge. Null is handled rather than assumed away.
                    briefStageId={spine.stages.find((s) => s.stageKind === "brief")?.id ?? null}
                    locked={activeStage.status === "locked"}
                    // Choosing a director IS moving on: the decision has no
                    // residue worth staring at, so land on the picture stage it
                    // was made for (doc 41 item 2).
                    onSaved={() => {
                      const img = spine.stages.find((s) => s.stageKind === "asset");
                      if (img) setActiveStageId(img.id);
                      void loadSpine(creativeId);
                    }}
                  />
                ) : activeStage?.stageKind === "asset" ? (
                  <ImageStage
                    creativeId={creativeId}
                    stageId={activeStage.id}
                    mode={activeStage.mode}
                    // The slot Refine is working on — stage state, not a pick.
                    modeSlotKey={(activeStage as { modeSlotKey?: string | null }).modeSlotKey ?? null}
                    brandId={brandId}
                    takes={spine.takes[activeStage.id] ?? []}
                    locked={activeStage.status === "locked"}
                    onChanged={() => void loadSpine(creativeId)}
                    onContinue={nextStage ? () => void openStage(nextStage.id) : undefined}
                  />
                ) : activeStage?.stageKind === "copy" ? (
                  <CopyStage
                    creativeId={creativeId}
                    stageId={activeStage.id}
                    locked={activeStage.status === "locked"}
                    // The picture Copy is written against, read off the Image
                    // stage's own "selected" take rather than passed around.
                    selectedImageUrl={(() => {
                      const img = spine.stages.find((s) => s.stageKind === "asset");
                      if (!img) return null;
                      const sel = (spine.takes[img.id] ?? []).find(
                        (t) => t.slotKey === "selected" && t.isCurrent,
                      );
                      const p = sel?.payload as { imageUrl?: unknown } | undefined;
                      return typeof p?.imageUrl === "string" ? p.imageUrl : null;
                    })()}
                    onSaved={() => void loadSpine(creativeId)}
                  />
                ) : activeStage?.stageKind === "crops" ? (
                  <CropStage
                    creativeId={creativeId}
                    stageId={activeStage.id}
                    locked={activeStage.status === "locked"}
                    selectedImageUrl={(() => {
                      const img = spine.stages.find((s) => s.stageKind === "asset");
                      if (!img) return null;
                      const sel = (spine.takes[img.id] ?? []).find(
                        (t) => t.slotKey === "selected" && t.isCurrent,
                      );
                      const p = sel?.payload as { imageUrl?: unknown } | undefined;
                      return typeof p?.imageUrl === "string" ? p.imageUrl : null;
                    })()}
                    // The hook is drawn into every frame, because whether it
                    // survives a channel's furniture is half of what this stage
                    // is checking.
                    hook={(() => {
                      const cp = spine.stages.find((s) => s.stageKind === "copy");
                      if (!cp) return null;
                      const cur = (spine.takes[cp.id] ?? []).find(
                        (t) => t.slotKey === "copy" && t.isCurrent,
                      );
                      const p = cur?.payload as { hook?: unknown } | undefined;
                      return typeof p?.hook === "string" ? p.hook : null;
                    })()}
                    onSaved={() => void loadSpine(creativeId)}
                  />
                ) : (
                  // Unreachable since Phase 4 finished: every stageKind has a
                  // component above. Kept as a plain fallback rather than the
                  // stale "arrives later in Phase 4" paragraph it used to show.
                  <div className="p-8">
                    <p className="text-[12.5px] text-muted-foreground">This stage could not be opened.</p>
                  </div>
                )}
              </div>

              {/*
                No standing bottom bar (doc 41 item 13, pick B). Publishing and
                review live in the panel the header chip opens; Why-this rides
                the stage title's InfoDot. The stage owns the full height.
              */}
            </div>

            {/*
              The publish panel: the full publishing + review surfaces, over
              the rail, one click from the chip. The components are the same
              ones that used to stand at the bottom — the decision moved, its
              machinery did not.
            */}
            {publishOpen && (
              <div
                className="absolute inset-y-0 right-0 z-30 flex w-[460px] max-w-full flex-col border-l border-border bg-background shadow-2xl"
                role="dialog"
                aria-label="Publishing and review"
                data-testid="panel-publish"
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-border-soft px-5 py-3">
                  <span className="ui-label text-grit-teal">
                    Publishing {"&"} review
                  </span>
                  <button
                    onClick={() => setPublishOpen(false)}
                    aria-label="Close the publish panel"
                    className="ml-auto rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover-elevate"
                    data-testid="button-close-publish"
                  >
                    Close
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ShipBar
                    creativeId={creativeId}
                    revision={revision}
                    // Shipping can reset an approval, so the decision below has
                    // to re-read. On its OWN counter, not the spine's: bumping
                    // the spine here would clear the publishing bar's success
                    // message the instant it appeared.
                    onShipped={() => setTeamRevision((n) => n + 1)}
                  />
                  <ReviewBar
                    creativeId={creativeId}
                    activeStageId={activeStage?.id ?? null}
                    revision={revision + teamRevision}
                    onDecided={() => void loadSpine(creativeId)}
                  />
                </div>
              </div>
            )}

            {/* The brand contract, permanently locked, and the Material rail. */}
            <aside className="flex w-[212px] shrink-0 flex-col border-l border-border-soft">
              <BrandContract
                brandId={brandId}
              />
              <MaterialRail
                stages={spine.stages}
                activeStage={activeStage}
                takesByStage={spine.takes}
              />
              {/*
                The proactive half of the sidebar. Below the contract and the
                rail because those state facts; this reacts to them. A stage
                save bumps the revision, and the bump IS the event.
              */}
              <SmartBar
                creativeId={creativeId}
                revision={revision}
                onOpenStage={(kind) => {
                  const target = spine.stages.find((s) => s.stageKind === kind);
                  if (target) void openStage(target.id);
                }}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
