import { useEffect, useRef, useState } from "react";

import { apiFetch, cn } from "@/lib/utils";
import { LayerComposer, type Drift } from "@/components/studio/LayerComposer";
import { MentionChips, MentionPickerList, reconcile, useMentions, type AssetOption } from "@/components/studio/mentions";

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

interface BoxRegion {
  shape: "box";
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LassoRegion {
  shape: "lasso";
  points: Array<{ x: number; y: number }>;
}

/*
 * Both shapes the server already accepts (region-edit.ts normalizeRegion has
 * spoken box, lasso and point since Phase 4) — the client just never offered
 * the lasso until Tony asked for it (2026-08-11). WHERE is the one part of an
 * image edit a person states precisely, and a box is a blunt way to say it
 * around a character's silhouette.
 */
type Region = BoxRegion | LassoRegion;

interface NamedRegion {
  key: string;
  label: string;
  region: { shape: "box"; x: number; y: number; w: number; h: number };
}

/**
 * A located layer, drawn ON the image.
 *
 * Tony, walking 5c: "no indication that there are now clickable layers when I
 * hover the cursor over them in the image." He was right, and the reasoning
 * that left them out was bad — doc 38 §3 says the grid is pictures and the
 * inspector is words, which is about where EXPLANATION goes, not about hiding
 * where a thing is. Once a layer has a position, the picture is the only honest
 * place to show it.
 */
export interface LayerOverlay {
  key: string;
  name: string;
  bbox: { x: number; y: number; w: number; h: number };
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
  /** For the instruction's `@` picker — mentions are brand-scoped. */
  brandId: string | null;
  /** Named regions derived from the take, so "the subject" needs no dragging. */
  namedRegions?: NamedRegion[];
  /** Located layers, drawn on the image and selectable there. */
  layers?: LayerOverlay[];
  /** What one layer edit or move costs, from the server that charges it. */
  layerEditCostUsd?: number;
  /** Which layer the inspector is pointing at, so the two views agree. */
  hoveredLayer?: string | null;
  selectedLayer?: string | null;
  onHoverLayer?: (key: string | null) => void;
  onSelectLayer?: (key: string | null) => void;
  /** For the attached composer's `@` picker and its edits. */
  onLayerEdited?: (result: { layerName: string; drift: Drift | null; unavailable: string | null; caveat: string | null }) => void;
  locked: boolean;
  onEdited: () => void;
}

/** Below this a drag is a click, not a selection. */
const MIN_DRAG = 0.02;
/** Mirrors the server's MIN_LASSO_POINTS / MIN_REGION_AREA so a doomed lasso
    is cleared here instead of bouncing off a 400. */
const MIN_LASSO_POINTS = 3;
const MIN_REGION_AREA = 0.0004;
/** A new lasso point is only recorded after this much movement, which keeps a
    slow careful trace from becoming a thousand-point payload. */
const LASSO_STEP = 0.008;

/** Shoelace area of a normalised polygon — same arithmetic as the server. */
function polygonArea(points: Array<{ x: number; y: number }>): number {
  if (points.length < MIN_LASSO_POINTS) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** SVG path (0..100 space) for a polygon, closed. */
function lassoPath(points: Array<{ x: number; y: number }>): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${(p.x * 100).toFixed(2)} ${(p.y * 100).toFixed(2)}`).join(" ") + " Z";
}

export function RegionEditor({
  creativeId,
  stageId,
  slotKey,
  imageUrl,
  brandId,
  namedRegions = [],
  layers = [],
  layerEditCostUsd = 0,
  hoveredLayer = null,
  selectedLayer = null,
  onHoverLayer,
  onSelectLayer,
  onLayerEdited,
  locked,
  onEdited,
}: RegionEditorProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null);
  /** Which way WHERE is being said: a corner-to-corner box, or a traced outline. */
  const [tool, setTool] = useState<"box" | "lasso">("box");
  const [tracing, setTracing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drift, setDrift] = useState<DriftReport | null>(null);
  const [driftUnavailable, setDriftUnavailable] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Array<{ name?: string; reason?: string }>>([]);

  /*
   * DRAGGING A LAYER. `moveTo` is the pending destination's top-left, and it
   * survives the pointer coming up: the drag says WHERE, and the move is only
   * spent when the attached composer's button is pressed. A drag that committed
   * on release would charge for a generation on a slip of the hand.
   *
   * AND IT BELONGS TO THE LAYER IT WAS DRAGGED FROM, which is why it carries
   * that layer's key and cannot be read against any other one.
   *
   * Found by review (doc 46 §2): this was a bare `{x, y}`, so dragging the mark
   * and then clicking the character handed the character the mark's destination
   * and "Move it here" charged $0.134 to move the wrong thing to coordinates
   * chosen for something else. Pointing at a layer must never be a commitment —
   * doc 40's P0.1, "a mode target is not a pick".
   *
   * Tagged AND cleared on selection change, deliberately: the tag makes a
   * mismatched move unreachable even in the render before the effect runs, and
   * the clearing stops an abandoned destination resurrecting when the user comes
   * back to the layer they dragged.
   */
  const [moveTo, setMoveTo] = useState<{ layerKey: string; x: number; y: number } | null>(null);
  const [moveGrab, setMoveGrab] = useState<{ dx: number; dy: number } | null>(null);

  const selected = layers.find((l) => l.key === selectedLayer) ?? null;
  /** The pending destination, but only ever for the layer it was dragged from. */
  const pendingMove = moveTo && selected && moveTo.layerKey === selected.key ? moveTo : null;
  /** Where the selected layer currently sits — its own box, or the drag. */
  const selectedAt = selected
    ? {
        x: pendingMove?.x ?? selected.bbox.x,
        y: pendingMove?.y ?? selected.bbox.y,
        w: selected.bbox.w,
        h: selected.bbox.h,
      }
    : null;

  function forgetPendingMove() {
    setMoveTo(null);
    setMoveGrab(null);
  }

  // Switching layers is not committing to anything, so the destination goes.
  useEffect(() => {
    setMoveTo(null);
    setMoveGrab(null);
  }, [selectedLayer]);

  function clearSelection() {
    forgetPendingMove();
    onSelectLayer?.(null);
  }

  /*
   * The same `@` machinery the sentence composer above this editor has. The
   * instruction here was the last composer without it (doc 41 item 3), which
   * meant "replace the logo with @Crown U primary" worked one textarea up and
   * silently did nothing in this one.
   */
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const m = useMentions(brandId);

  function chooseMention(asset: AssetOption) {
    const el = instructionRef.current;
    const caret = el ? el.selectionStart : instruction.length;
    const r = m.choose(asset, instruction, caret);
    if (!r) return;
    setInstruction(r.line);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  }

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
    /*
     * Pressing inside the SELECTED layer drags it, and that beats drawing a new
     * box: the selection is the thing under the cursor, so a drag there can only
     * mean "take this somewhere".
     */
    if (selectedAt &&
        p.x >= selectedAt.x && p.x <= selectedAt.x + selectedAt.w &&
        p.y >= selectedAt.y && p.y <= selectedAt.y + selectedAt.h) {
      setMoveGrab({ dx: p.x - selectedAt.x, dy: p.y - selectedAt.y });
      setRegion(null);
      return;
    }
    // Drawing an area by hand is a different way of saying where, so a
    // destination dragged a moment ago is abandoned rather than left pending.
    forgetPendingMove();
    if (tool === "lasso") {
      setTracing(true);
      setRegion({ shape: "lasso", points: [p] });
      return;
    }
    setDragFrom(p);
    setRegion(null);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = pointAt(e);
    if (!p) return;
    if (moveGrab && selected) {
      // Clamped so a layer cannot be dragged out of its own picture.
      setMoveTo({
        layerKey: selected.key,
        x: Math.min(1 - selected.bbox.w, Math.max(0, p.x - moveGrab.dx)),
        y: Math.min(1 - selected.bbox.h, Math.max(0, p.y - moveGrab.dy)),
      });
      return;
    }
    if (tool === "lasso") {
      if (!tracing) return;
      setRegion((r) => {
        if (!r || r.shape !== "lasso") return r;
        const last = r.points[r.points.length - 1];
        // Only record real movement, so a slow trace stays a reasonable payload.
        if (Math.hypot(p.x - last.x, p.y - last.y) < LASSO_STEP) return r;
        return { shape: "lasso", points: [...r.points, p] };
      });
      return;
    }
    if (!dragFrom) return;
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
    setTracing(false);
    /*
     * Releasing a layer drag does NOT spend anything. The destination stays
     * pending until the attached composer's button is pressed, because a
     * generation charged on a slip of the hand is not undoable.
     */
    if (moveGrab) {
      setMoveGrab(null);
      // A drag that never really moved is a click, not a relocation.
      setMoveTo((t) => {
        if (!t || !selected || t.layerKey !== selected.key) return null;
        const shifted = Math.abs(t.x - selected.bbox.x) > MIN_DRAG || Math.abs(t.y - selected.bbox.y) > MIN_DRAG;
        return shifted ? t : null;
      });
      return;
    }
    // A stray click should clear the selection rather than leave a sliver the
    // server will reject with an error the user cannot connect to their action.
    setRegion((r) => {
      if (!r) return null;
      if (r.shape === "box") return r.w < MIN_DRAG || r.h < MIN_DRAG ? null : r;
      return r.points.length < MIN_LASSO_POINTS || polygonArea(r.points) < MIN_REGION_AREA ? null : r;
    });
  }

  async function submit() {
    if (!region || !instruction.trim() || locked || busy) return;
    setBusy(true);
    setError(null);
    setDrift(null);
    setDriftUnavailable(null);
    setDropped([]);
    try {
      const text = instruction.trim();
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/region-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, region, instruction: text, mentions: reconcile(m.mentions, text) }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; drift?: DriftReport | null; driftUnavailable?: string | null; droppedMentions?: Array<{ name?: string; reason?: string }> }
        | null;
      if (!res.ok) {
        // The server's copy already says whether anything was charged.
        setError(body?.error ?? "That edit could not be made.");
        return;
      }
      setDrift(body?.drift ?? null);
      setDriftUnavailable(body?.driftUnavailable ?? null);
      if (Array.isArray(body?.droppedMentions) && body.droppedMentions.length > 0) setDropped(body.droppedMentions);
      setInstruction("");
      m.setMentions([]);
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

        {/*
          * The layers, on the picture. Painted smallest LAST so a small layer
          * sitting inside a big one is still the thing you hit — a mark inside a
          * keyline frame is the common case, and the frame would otherwise
          * swallow every click.
          *
          * Suppressed while a box or lasso is being drawn: two selection models
          * live on this frame, and a layer outline under a drag reads as though
          * the drag had snapped to it.
          */}
        {!region && layers.length > 0 && (
          <>
            {[...layers]
              .filter((l) => l.key !== selectedLayer)
              .sort((a, b) => b.bbox.w * b.bbox.h - a.bbox.w * a.bbox.h)
              .map((l) => {
                const active = hoveredLayer === l.key || selectedLayer === l.key;
                return (
                  <button
                    key={l.key}
                    type="button"
                    aria-label={`Change ${l.name} and nothing else`}
                    onPointerEnter={() => onHoverLayer?.(l.key)}
                    onPointerLeave={() => onHoverLayer?.(null)}
                    /* Stop the frame's drag from starting, or clicking a layer
                       would also begin a box nobody asked for. */
                    onPointerDown={(e) => { e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); if (!locked) onSelectLayer?.(l.key); }}
                    disabled={locked}
                    className={cn(
                      "absolute cursor-pointer rounded-sm border transition-colors",
                      active
                        ? "border-grit-teal bg-grit-teal/15"
                        : "border-dashed border-white/25 bg-transparent hover:border-grit-teal hover:bg-grit-teal/10",
                    )}
                    style={{ left: pct(l.bbox.x), top: pct(l.bbox.y), width: pct(l.bbox.w), height: pct(l.bbox.h) }}
                    data-testid={`overlay-layer-${l.key}`}
                  >
                    <span
                      className={cn(
                        "pointer-events-none absolute left-0 top-0 max-w-full truncate rounded-br-sm bg-grit-teal px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.06em] text-black transition-opacity",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    >
                      {l.name}
                    </span>
                  </button>
                );
              })}
          </>
        )}

        {/*
          * The SELECTED layer: where it is now, where it came from if it has been
          * dragged, and the composer attached under it. Higgsfield puts the box
          * on the element; so does this, because that is what makes the scope
          * obvious without a sentence explaining it (doc 45 §1.2).
          */}
        {!region && selected && selectedAt && (
          <>
            {pendingMove && (
              /* Where it started, left visible so the move is legible as a move
                 rather than as the element mysteriously appearing elsewhere. */
              <div
                className="pointer-events-none absolute rounded-sm border border-dashed border-white/30"
                style={{ left: pct(selected.bbox.x), top: pct(selected.bbox.y), width: pct(selected.bbox.w), height: pct(selected.bbox.h) }}
              />
            )}
            <div
              className={cn(
                "absolute rounded-sm border-2 border-grit-teal bg-grit-teal/10",
                locked ? "cursor-default" : moveGrab ? "cursor-grabbing" : "cursor-grab",
              )}
              style={{ left: pct(selectedAt.x), top: pct(selectedAt.y), width: pct(selectedAt.w), height: pct(selectedAt.h) }}
              data-testid="overlay-layer-selected"
            >
              <span className="pointer-events-none absolute left-0 top-0 max-w-full truncate rounded-br-sm bg-grit-teal px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.06em] text-black">
                {selected.name}
              </span>
            </div>

            {/*
              * Anchored under the layer, flipped above it when the layer sits low
              * enough that below would fall off the picture.
              */}
            {(() => {
              const low = selectedAt.y + selectedAt.h > 0.62;
              const id = selected.key.startsWith("layer:") ? selected.key.slice("layer:".length) : null;
              if (!id) return null;
              return (
                <div
                  className="absolute z-10 flex"
                  style={{
                    left: pct(Math.min(selectedAt.x, 0.98)),
                    ...(low
                      ? { bottom: pct(Math.max(0, 1 - selectedAt.y)) }
                      : { top: pct(selectedAt.y + selectedAt.h) }),
                  }}
                >
                  <LayerComposer
                    creativeId={creativeId}
                    stageId={stageId}
                    slotKey={slotKey}
                    brandId={brandId}
                    layerId={id}
                    layerName={selected.name}
                    moveTo={pendingMove ? { x: pendingMove.x, y: pendingMove.y } : null}
                    costUsd={layerEditCostUsd}
                    flipped={low}
                    onCancelMove={forgetPendingMove}
                    onDone={(r) => { onLayerEdited?.(r); onEdited(); }}
                    onClose={clearSelection}
                  />
                </div>
              );
            })()}
          </>
        )}

        {region?.shape === "box" && (
          <>
            <div
              className="pointer-events-none absolute border border-grit-teal bg-grit-teal/10"
              style={{ left: pct(region.x), top: pct(region.y), width: pct(region.w), height: pct(region.h) }}
            />
            {/* Everything outside the selection dims, so the mask is legible on
                a busy image without drawing a shape on top of the subject. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: "rgba(0,0,0,0.45)",
                clipPath: `polygon(0% 0%, 0% 100%, ${pct(region.x)} 100%, ${pct(region.x)} ${pct(region.y)}, ${pct(region.x + region.w)} ${pct(region.y)}, ${pct(region.x + region.w)} ${pct(region.y + region.h)}, ${pct(region.x)} ${pct(region.y + region.h)}, ${pct(region.x)} 100%, 100% 100%, 100% 0%)`,
              }}
            />
          </>
        )}

        {region?.shape === "lasso" && region.points.length >= 2 && (
          /* The same dim-outside idea, drawn as one evenodd path: the frame
             with the traced outline cut out of it. */
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {region.points.length >= MIN_LASSO_POINTS && (
              <path
                d={`M0 0 H100 V100 H0 Z ${lassoPath(region.points)}`}
                fill="rgba(0,0,0,0.45)"
                fillRule="evenodd"
              />
            )}
            <path
              d={lassoPath(region.points)}
              fill="rgba(0,161,156,0.1)"
              stroke="#00A19C"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>

      {/* How WHERE gets said: corner-to-corner, or traced around. */}
      {!locked && (
        <div className="inline-flex items-center gap-0.5 rounded-sm border border-border p-0.5" role="group" aria-label="Selection tool">
          {(["box", "lasso"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tool === t}
              disabled={busy}
              onClick={() => {
                setTool(t);
                setRegion(null);
              }}
              className={cn(
                "rounded-sm px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] hover-elevate disabled:opacity-40",
                tool === t ? "bg-grit-teal/15 text-cyber-teal" : "text-muted-foreground",
              )}
              data-testid={`button-region-tool-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

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
        <div className="relative">
          <textarea
            ref={instructionRef}
            value={instruction}
            onChange={(e) => { setInstruction(e.target.value); m.onLineChange(e.target.value, e.target.selectionStart); }}
            onClick={(e) => m.onCaretMove(instruction, e.currentTarget.selectionStart)}
            onBlur={m.onBlur}
            onKeyDown={(e) => {
              if (m.picker && m.matches.length > 0 && (e.key === "Enter" || e.key === "Tab")) {
                e.preventDefault();
                const pick = m.matches[m.highlight];
                if (pick) chooseMention(pick);
                return;
              }
              m.onKeyDown(e);
            }}
            disabled={locked || busy}
            rows={2}
            placeholder={
              region
                ? "What should change in the selection? @ attaches a reference"
                : tool === "box"
                  ? "Drag a box on the image first"
                  : "Trace around the area on the image first"
            }
            aria-label="What should change in the selected region. Type @ to attach a reference."
            aria-expanded={m.picker !== null}
            aria-controls={m.picker ? "region-mention-picker" : undefined}
            className="w-full resize-none rounded-sm border border-border bg-raised px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal disabled:opacity-60"
          />
          <MentionPickerList m={m} pickerId="region-mention-picker" onChoose={chooseMention} />
        </div>
        <MentionChips mentions={m.mentions} />
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

      {dropped.length > 0 && (
        <p className="text-[10.5px] leading-relaxed text-victory-gold">
          Not used: {dropped.map((d) => `${d.name ?? "an attachment"} — ${(d.reason ?? "not eligible").toLowerCase()}`).join("; ")}
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
