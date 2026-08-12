import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { Timeline, type TimelineData } from "@/components/timeline/timeline";
import type { StageTake } from "@/components/studio/RefineDeck";

const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * Stage 03 · Media · Sequence — build step 1 of the sequencing plan
 * (doc 42 third addendum; Tony picked 1A + 2B).
 *
 * The third medium tab: the Phase 9 timeline, finally inside the stage it was
 * built for, with the Add-a-shot hub in front of it. Three sources today —
 * ANIMATE A TAKE (any of this stage's stills, through the same locked video
 * path the Motion tab uses), the post's existing clips, and the brand's
 * library footage (policy-filtered, refusals counted). Upload arrives with a
 * later step.
 *
 * The timeline itself is the Phase 9 component untouched: lanes, blocks,
 * scheduled duck windows, the mixer's warnings in its own words. This panel
 * only feeds it and adds shots.
 */

interface Candidate {
  sourceKind: "generated" | "library_asset" | "studio_take";
  id: string;
  name: string;
  durationMs: number | null;
  thumbnailUrl: string | null;
}

interface Candidates {
  generated: Candidate[];
  studio: Candidate[];
  library: Candidate[];
  hidden: { count: number; reasons: Array<{ reason: string; count: number }> };
  uploadNote: string;
}

type HubSource = "animate" | "clips" | "library";

export function SequencePanel({
  creativeId,
  stageId,
  /** Every take on this stage — the stills the Animate source offers. */
  takes,
  locked,
  onChanged,
}: {
  creativeId: string;
  stageId: string;
  takes: StageTake[];
  locked: boolean;
  onChanged: () => void;
}) {
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [checkedForSequence, setCheckedForSequence] = useState(false);
  const [data, setData] = useState<TimelineData | null>(null);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [source, setSource] = useState<HubSource | null>(null);
  const [busy, setBusy] = useState(false);
  /** The slot currently being animated, so its tile can say so. */
  const [animating, setAnimating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Whether this post already has a sequence. One row per post for now — the
  // list endpoint exists so this never mints duplicates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { sequences?: Array<{ id: string }> };
        if (!cancelled) setSequenceId(body.sequences?.[0]?.id ?? null);
      } catch {
        // The panel offers Start below; a failed read reads as "none yet".
      } finally {
        if (!cancelled) setCheckedForSequence(true);
      }
    })();
    return () => { cancelled = true; };
  }, [creativeId]);

  const loadTimeline = useCallback(async () => {
    if (!sequenceId) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as TimelineData);
    } catch {
      setError("The sequence could not be loaded.");
    }
  }, [sequenceId]);

  useEffect(() => { void loadTimeline(); }, [loadTimeline]);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/clip-candidates`);
      if (!res.ok) return;
      setCandidates((await res.json()) as Candidates);
    } catch {
      // The hub's lists render empty rather than blocking the timeline.
    }
  }, [creativeId]);

  useEffect(() => {
    if (source === "clips" || source === "library") void loadCandidates();
  }, [source, loadCandidates]);

  async function startSequence() {
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { sequence?: { id: string }; error?: string } | null;
      if (!res.ok || !body?.sequence?.id) {
        setError(body?.error ?? "The sequence could not be started.");
        return;
      }
      setSequenceId(body.sequence.id);
    } catch {
      setError("The sequence could not be started.");
    } finally {
      setBusy(false);
    }
  }

  /** Animate a still into a new shot — the same priced, locked path as Motion. */
  async function animateTake(slotKey: string) {
    if (!sequenceId || animating || locked) return;
    setAnimating(slotKey);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/stages/${stageId}/motion-convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, sequenceId }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "The shot could not be made.");
        return;
      }
      await loadTimeline();
      onChanged();
    } catch {
      setError("The shot could not be reached. Nothing was charged.");
    } finally {
      setAnimating(null);
    }
  }

  /** Add an already-existing clip or a library video as a shot. */
  async function addCandidate(c: Candidate) {
    if (!sequenceId || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          c.sourceKind === "studio_take"
            ? { sourceKind: "studio_take", sourceTakeId: c.id, ...(c.durationMs ? { trimEndMs: c.durationMs } : {}) }
            : c.sourceKind === "generated"
              ? { sourceKind: "generated", sourceVariantId: c.id }
              : { sourceKind: "library_asset", sourceAssetId: c.id },
        ),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "That shot could not be added.");
        return;
      }
      await loadTimeline();
    } catch {
      setError("That shot could not be added.");
    } finally {
      setBusy(false);
    }
  }

  /** This stage's stills, newest slots last, each one a possible shot. */
  const stills = takes.filter((t) => {
    const p = t.payload as { imageUrl?: unknown } | undefined;
    return t.isCurrent && typeof p?.imageUrl === "string";
  });

  const thumbOf = (t: StageTake) => (t.payload as { imageUrl?: string }).imageUrl ?? "";

  if (!checkedForSequence) {
    return <div className="mx-auto max-w-5xl p-6"><p className="text-[12px] text-dim">Reading the sequence…</p></div>;
  }

  if (!sequenceId) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
          Stage 03 · Sequence
        </p>
        <h2 className="font-display text-xl tracking-wide text-foreground">Several shots, one post</h2>
        <button
          onClick={() => void startSequence()}
          disabled={busy || locked}
          className="flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate disabled:opacity-40"
          data-testid="button-start-sequence"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <>Start a sequence <ArrowRight size={9} /></>}
        </button>
        {error && <p className="text-[11.5px] text-rebel-pink">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-start gap-3">
        <div className="space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
            Stage 03 · Sequence
          </p>
          <h2 className="font-display text-xl tracking-wide text-foreground">The cut</h2>
        </div>
      </div>

      {error && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-rebel-pink">
          {error}
        </p>
      )}

      {data && (
        <Timeline
          data={data}
          onReorder={async (order) => {
            setError(null);
            const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}/clips/order`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order }),
            }).catch(() => null);
            if (!res?.ok) setError("The shots could not be reordered.");
            await loadTimeline();
          }}
        />
      )}

      {/* The Add-a-shot hub. Three sources; upload arrives with a later step. */}
      {!locked && (
        <div className="rounded-sm border border-border bg-card px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.11em] text-grit-teal">Add a shot</span>
            {([
              ["animate", "Animate a take"],
              ["clips", "Existing clips"],
              ["library", "Library footage"],
            ] as Array<[HubSource, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSource((s) => (s === key ? null : key))}
                aria-pressed={source === key}
                className={cn(
                  "rounded-sm border px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.06em] hover-elevate",
                  source === key ? "border-grit-teal bg-grit-teal/10 text-cyber-teal" : "border-border text-muted-foreground",
                )}
                data-testid={`button-shot-source-${key}`}
              >
                {label}
              </button>
            ))}
            <div className="flex-1" />
            {source === "animate" && (
              <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-dim">
                billed per second of clip {"·"} the shot lands at the end of the cut
              </span>
            )}
          </div>

          {source === "animate" && (
            <div className="mt-2 flex flex-wrap gap-2">
              {stills.length === 0 && (
                <p className="text-[11px] text-dim">No stills on this stage yet. Run the spread on the Image tab first.</p>
              )}
              {stills.map((t) => (
                <button
                  key={t.id}
                  onClick={() => void animateTake(t.slotKey)}
                  disabled={animating !== null}
                  title={t.slotKey}
                  className={cn(
                    "relative h-16 w-16 overflow-hidden rounded-sm border hover-elevate disabled:opacity-50",
                    animating === t.slotKey ? "border-grit-teal" : "border-border",
                  )}
                  data-testid={`button-animate-${t.slotKey}`}
                >
                  <img src={thumbOf(t)} alt="" className="h-full w-full object-cover" />
                  {animating === t.slotKey && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 size={14} className="animate-spin text-cyber-teal" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {(source === "clips" || source === "library") && (
            <div className="mt-2 space-y-1.5">
              {(source === "clips"
                ? [...(candidates?.studio ?? []), ...(candidates?.generated ?? [])]
                : candidates?.library ?? []
              ).map((c) => (
                <button
                  key={`${c.sourceKind}:${c.id}`}
                  onClick={() => void addCandidate(c)}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 rounded-sm border border-border px-2 py-1.5 text-left hover-elevate disabled:opacity-50"
                  data-testid={`button-add-candidate-${c.id}`}
                >
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-sm object-cover" />
                  ) : (
                    <span className="h-9 w-9 shrink-0 rounded-sm border border-border/60" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">{c.name}</span>
                  <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[0.06em] text-dim">
                    {c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : "length unknown"}
                  </span>
                </button>
              ))}
              {source === "clips" && (candidates?.studio ?? []).length + (candidates?.generated ?? []).length === 0 && (
                <p className="text-[11px] text-dim">No clips on this post yet. Animate a take, or the pick on the Motion tab.</p>
              )}
              {source === "library" && (candidates?.library ?? []).length === 0 && (
                <p className="text-[11px] text-dim">No usable video in this brand's library.</p>
              )}
              {source === "library" && candidates && candidates.hidden.count > 0 && (
                <p className="text-[10.5px] leading-relaxed text-victory-gold">
                  {candidates.hidden.count} hidden by policy: {candidates.hidden.reasons.map((r) => `${r.count} — ${r.reason.toLowerCase()}`).join("; ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
