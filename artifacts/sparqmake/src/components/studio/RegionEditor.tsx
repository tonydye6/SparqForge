import { useRef, useState } from "react";

import { apiFetch, cn } from "@/lib/utils";

/**
 * Region editing, on the image.
 *
 * Spec: plan item 4, and `20_SPEC_00_PRINCIPLES.md` §1.12, §1.13, §1.17.
 *
 * §1.12: images are the artifact furthest from something you could make by hand,
 * so instruction is the only path. What this adds is WHERE, which is the one part
 * of an image edit a person can express directly and precisely. Dragging a box is
 * not a workaround for not having a brush; it is the honest input.
 *
 * The drift report is the reason this can be trusted. The model gets no mask, only
 * a description of one, so it can ignore the boundary. Afterwards the server
 * measures how much changed outside the selection and says so. Per §1.13 that
 * advises rather than blocks: the result is kept either way, because a "repainted"
 * verdict may still be the picture you wanted.
 */

interface Region {
  shape: "box";
  x: number;
  y: number;
  w: number;
  h: number;
}

interface NamedRegion {
  key: string;
  label: string;
  region: { shape: "box"; x: number; y: number; w: number; h: number };
}

interface DriftReport {
  driftPercent: number;
  verdict: "clean" | "notable" | "repainted";
  message: string;
}

interface RegionEditorProps {
  creativeId: string;
  stageId: string;
  slotKey: string;
  imageUrl: string;
  /** Named regions derived from the take, so "the subject" needs no dragging. */
  namedRegions?: NamedRegion[];
  locked: boolean;
  onEdited: () => void;
}

/** Below this a drag is a click, not a selection. */
const MIN_DRAG = 0.02;

export function RegionEditor({
  creativeId,
  stageId,
  slotKey,
  imageUrl,
  namedRegions = [],
  locked,
  onEdited,
}: RegionEditorProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftUnavailable, setDriftUnavailable] = useState<string | null>(null);

  /** Pointer position as a 0..1 fraction of the frame. */
  function pointAt(e: React.PointerEvent): { x: number; y: number } | null {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (locked || busy) return;
    const p = pointAt(e);
    if (!p) return;
    // Capture the pointer so a drag that leaves the image still tracks, rather
    // than freezing the selection at the edge.
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragFrom(p);
    setRegion(null);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragFrom) return;
    const p = pointAt(e);
    if (!p) return;
    setRegion({
      shape: "box",
      x: Math.min(dragFrom.x, p.x),
      y: Math.min(dragFrom.y, p.y),
      w: Math.abs(p.x - dragFrom.x),
      h: Math.abs(p.y - dragFrom.y),
    });
  }

  function onPointerUp() {
    setDragFrom(null);
    // A stray click should clear the selection rather than leave a sliver the
    // server will reject with an error the user cannot connect to their action.
    setRegion((r) => (r && (r.w < MIN_DRAG || r.h < MIN_DRAG) ? null : r));
  }

  async function submit() {
    if (!region || !instruction.trim() || locked || busy) return;
    setBusy(true);
    setError(null);
    setDrift(null);
    setDriftUnavailable(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/region-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, region, instruction: instruction.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; drift?: DriftReport | null; driftUnavailable?: string | null }
        | null;
      if (!res.ok) {
        // The server's copy already says whether anything was charged.
        setError(body?.error ?? "That edit could not be made.");
        return;
      }
      setDrift(body?.drift ?? null);
      setDriftUnavailable(body?.driftUnavailable ?? null);
      setInstruction("");
      setRegion(null);
      onEdited();
    } catch {
      setError("That edit could not be reached. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  const pct = (n: number) => `${n * 100}%`;

  return (
    <div className="space-y-2">
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "relative select-none overflow-hidden rounded-sm border border-border bg-card",
          locked ? "cursor-default" : "cursor-crosshair",
        )}
      >
        <img src={imageUrl} alt="" draggable={false} className="block w-full" />

        {region && (
          <div
            className="pointer-events-none absolute border border-grit-teal bg-grit-teal/10"
            style={{ left: pct(region.x), top: pct(region.y), width: pct(region.w), height: pct(region.h) }}
          />
        )}

        {/* Everything outside the selection dims, so the mask is legible on a
            busy image without drawing a shape on top of the subject. */}
        {region && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: "rgba(0,0,0,0.45)",
              clipPath: `polygon(0% 0%, 0% 100%, ${pct(region.x)} 100%, ${pct(region.x)} ${pct(region.y)}, ${pct(region.x + region.w)} ${pct(region.y)}, ${pct(region.x + region.w)} ${pct(region.y + region.h)}, ${pct(region.x)} ${pct(region.y + region.h)}, ${pct(region.x)} 100%, 100% 100%, 100% 0%)`,
            }}
          />
        )}
      </div>

      {namedRegions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-dim">Or pick</span>
          {namedRegions.map((n) => (
            <button
              key={n.key}
              onClick={() => setRegion(n.region)}
              disabled={locked || busy}
              className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
            >
              {n.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={locked || busy}
          rows={2}
          placeholder={region ? "What should change in the selection?" : "Drag a box on the image first"}
          aria-label="What should change in the selected region"
          className="w-full resize-none rounded-sm border border-border bg-raised px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal disabled:opacity-60"
        />
        <div className="flex items-center gap-2">
          <p className="text-[10.5px] leading-snug text-dim">
            {region
              ? "The model is told where, in words, then the server measures how far the change strayed outside it."
              : "Nothing is selected, so nothing can be edited yet."}
          </p>
          <button
            onClick={() => void submit()}
            disabled={!region || !instruction.trim() || locked || busy}
            className="ml-auto shrink-0 rounded-sm bg-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate disabled:opacity-40"
          >
            {busy ? "Editing" : "Edit this region"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-2.5 py-1.5 text-[11px] leading-relaxed text-rebel-pink">
          {error}
        </p>
      )}

      {/* The drift report. Advises, never blocks (§1.13). */}
      {drift && (
        <div
          className={cn(
            "rounded-sm border bg-card px-2.5 py-1.5",
            drift.verdict === "clean" ? "border-border/60" : "border-rebel-pink/40",
          )}
        >
          <p className="font-mono text-[8.5px] uppercase tracking-[0.09em] text-dim">
            Drift · <span data-numeric>{drift.driftPercent}%</span> outside your selection
          </p>
          <p
            className={cn(
              "mt-0.5 text-[11px] leading-relaxed",
              drift.verdict === "clean" ? "text-muted-foreground" : "text-rebel-pink",
            )}
          >
            {drift.message}
          </p>
        </div>
      )}

      {driftUnavailable && (
        <p className="rounded-sm border border-victory-gold/40 bg-card px-2.5 py-1.5 text-[11px] leading-relaxed text-victory-gold">
          {driftUnavailable}
        </p>
      )}
    </div>
  );
}
