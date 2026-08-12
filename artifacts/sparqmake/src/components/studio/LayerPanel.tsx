import { useState } from "react";
import { Loader2, Pin } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { InfoDot } from "@/components/studio/InfoDot";
import { layerIdOf, type LayersResponse } from "@/components/studio/useTakeLayers";

/**
 * Stage 03 · Refine · what this take is made of, and changing one part of it.
 *
 * The list is words beside the picture; the boxes themselves are drawn ON the
 * picture by RegionEditor, and hovering either one lights up the other. Doc 38
 * §3 puts explanation in the inspector, not position — a located layer has to be
 * visible where it is.
 *
 * Two honesty rules this panel carries, both learned by walking it:
 *  · a KNOWN layer is one we know is in the picture, from which authoritative
 *    file — not one we know the position of. Rows with no box say NOT LOCATED
 *    and cannot be selected, because a guessed box would scope an edit to the
 *    wrong pixels.
 *  · a CARRIED FORWARD row came from the take this one was edited from, so an
 *    edit since could have changed it. Detection is what settles that.
 *
 * Selecting a located layer opens a one-line composer for that layer alone. The
 * edit goes through the same region-edit path as a drawn box, so the drift
 * report proves what it claims.
 */

interface Drift {
  driftPercent: number;
  verdict: "clean" | "notable" | "repainted";
  message: string;
}

interface LayerPanelProps {
  creativeId: string;
  stageId: string;
  slotKey: string;
  locked: boolean;
  data: LayersResponse | null;
  error: string | null;
  /** Re-read the list. Detection creates no take, so nothing else can infer it. */
  reload: () => void;
  /** Shared with the image overlay so the two views cannot disagree. */
  hovered: string | null;
  selected: string | null;
  onHover: (key: string | null) => void;
  onSelect: (key: string | null) => void;
  /** A layer edit makes a new take, so the deck has to reload too. */
  onEdited: () => void;
}

/**
 * The swatch for a layer with no attached file behind it.
 *
 * A detected element nobody attached — a sparkle burst, a divider line — has no
 * asset to show, and an empty grey square is a worse answer than the pixels
 * themselves. So the take is used as the thumbnail, scaled and offset so the
 * layer's own box fills the swatch. The cast keeps its real file, because that
 * file IS the element on its own where a crop carries its neighbours.
 */
function boxCropStyle(imageUrl: string, bbox: { x: number; y: number; w: number; h: number }) {
  const w = Math.max(bbox.w, 0.01);
  const h = Math.max(bbox.h, 0.01);
  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: `${(100 / w).toFixed(2)}% ${(100 / h).toFixed(2)}%`,
    // A full-width box has no room to pan; the division would be by zero.
    backgroundPosition:
      `${w >= 1 ? 50 : (bbox.x / (1 - w)) * 100}% ${h >= 1 ? 50 : (bbox.y / (1 - h)) * 100}%`,
    backgroundRepeat: "no-repeat",
  };
}

export function LayerPanel({
  creativeId,
  stageId,
  slotKey,
  locked,
  data,
  error,
  reload,
  hovered,
  selected,
  onHover,
  onSelect,
  onEdited,
}: LayerPanelProps) {
  const [busyError, setBusyError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  /** What the last press actually did, so pressing a button says something. */
  const [result, setResult] = useState<string | null>(null);
  const [drift, setDrift] = useState<{ layerName: string; drift: Drift | null; unavailable: string | null } | null>(null);

  async function findLayers() {
    if (finding || locked) return;
    setFinding(true);
    setBusyError(null);
    setDrift(null);
    setResult(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/detect-layers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; summary?: string } | null;
      if (!res.ok) {
        setBusyError(body?.error ?? "This picture could not be taken apart.");
        return;
      }
      /*
       * The server's own sentence, shown rather than inferred. Detection writes
       * no take, so without an explicit reload NOTHING on screen changes — which
       * is exactly what pressing this button used to look like.
       */
      setResult(body?.summary ?? "Taken apart.");
      reload();
    } catch {
      setBusyError("That could not be reached. Nothing was charged.");
    } finally {
      setFinding(false);
    }
  }

  async function editLayer(layerId: string) {
    const text = instruction.trim();
    if (!text || sending || locked) return;
    setSending(true);
    setBusyError(null);
    setDrift(null);
    setResult(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/region-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, layerId, instruction: text }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        layerName?: string;
        drift?: Drift | null;
        driftUnavailable?: string | null;
      } | null;
      if (!res.ok) {
        setBusyError(body?.error ?? "That change could not be made.");
        return;
      }
      setInstruction("");
      onSelect(null);
      setDrift({
        layerName: body?.layerName ?? "that layer",
        drift: body?.drift ?? null,
        unavailable: body?.driftUnavailable ?? null,
      });
      reload();
      onEdited();
    } catch {
      setBusyError("That change could not be reached. Nothing was charged.");
    } finally {
      setSending(false);
    }
  }

  if (error && !data) {
    return (
      <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-dim" data-testid="text-layers-error">
        {error}
      </p>
    );
  }
  if (!data || data.layers.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="panel-layers">
      <div className="flex items-center gap-1.5">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.11em] text-dim">
          Layers {"·"} {data.layers.length}
        </p>
        <InfoDot text="Read off the take itself: the real files this picture was rendered from, back to front. NOT LOCATED means a layer is known to be in the frame but has not been measured into a position, so nothing selects it yet. CARRIED FORWARD means it came from the take this one was edited from, since an edit is handed the previous picture rather than the original files." />
      </div>

      {busyError && <p className="text-[10.5px] leading-relaxed text-rebel-pink">{busyError}</p>}

      {data.layers.map((l) => {
        const id = layerIdOf(l.key);
        const selectable = !locked && id !== null && l.kind !== "base";
        const isSelected = selected === l.key;
        const isHovered = hovered === l.key;
        return (
          <div key={l.key}>
            <button
              type="button"
              onPointerEnter={() => selectable && onHover(l.key)}
              onPointerLeave={() => selectable && onHover(null)}
              onClick={() => selectable && onSelect(isSelected ? null : l.key)}
              disabled={!selectable}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm border p-1.5 text-left",
                isSelected || isHovered
                  ? "border-grit-teal bg-grit-teal/5"
                  : l.bbox
                    ? "border-border/60"
                    : "border-border/30",
                selectable && "hover-elevate",
              )}
              data-testid={`row-layer-${l.kind}`}
            >
              <div
                className="h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-border/60 bg-card"
                style={!l.thumbnailUrl && l.bbox && data.imageUrl ? boxCropStyle(data.imageUrl, l.bbox) : undefined}
              >
                {l.thumbnailUrl ? (
                  <img src={l.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-[11.5px] leading-tight text-foreground">
                  <span className="truncate">{l.name}</span>
                  {l.pinned && <Pin size={9} className="shrink-0 text-victory-gold" />}
                  {l.note && <InfoDot text={l.note} />}
                </p>
                {/*
                  * State, not classification. The kind is already in the name and
                  * the thumbnail, and spelling it out here pushed "not located" —
                  * the one claim this panel must not swallow — off the end of a
                  * 220px column. A row with nothing to disclose says nothing.
                  */}
                {(!l.bbox || l.origin === "inherited_cast") && (
                  <p className="truncate font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
                    {!l.bbox && <>not located</>}
                    {!l.bbox && l.origin === "inherited_cast" && <> {"·"} </>}
                    {l.origin === "inherited_cast" && <>carried forward</>}
                  </p>
                )}
              </div>
            </button>

            {isSelected && id && (
              <div className="mt-1 rounded-sm border border-grit-teal/50 bg-card px-2 py-1.5">
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void editLayer(id); }
                    if (e.key === "Escape") { onSelect(null); setInstruction(""); }
                  }}
                  autoFocus
                  placeholder={`change only ${l.name.toLowerCase()}`}
                  aria-label={`Change ${l.name} and nothing else`}
                  className="w-full border-0 bg-transparent p-0 text-[12px] leading-snug text-foreground outline-none placeholder:text-dim"
                  data-testid="input-layer-instruction"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-dim">
                    This layer only {"·"} about $0.13
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => void editLayer(id)}
                    disabled={!instruction.trim() || sending}
                    className="rounded-sm border border-grit-teal px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-cyber-teal hover-elevate disabled:opacity-40"
                    data-testid="button-layer-edit"
                  >
                    {sending ? <Loader2 size={10} className="animate-spin" /> : "Change it"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* What the last press did. Detection changes no picture, so if the button
          does not say what happened, nothing does. */}
      {result && (
        <p className="text-[10.5px] leading-relaxed text-cyber-teal" data-testid="text-layers-result">
          {result}
        </p>
      )}

      {/*
        * The drift report, which is what makes "this layer only" a claim rather
        * than a hope. It measures what changed OUTSIDE the layer's own area, so
        * a model that repainted the frame while claiming to touch one corner is
        * caught by the number instead of by somebody noticing later.
        */}
      {drift && (
        <p
          className={cn(
            "text-[10.5px] leading-relaxed",
            drift.drift?.verdict === "clean" ? "text-cyber-teal" : "text-victory-gold",
          )}
          data-testid="text-layer-drift"
        >
          {drift.layerName}: {drift.unavailable ?? drift.drift?.message}
        </p>
      )}

      {!result && (
        <p className="pt-1 text-[10.5px] leading-relaxed text-dim" data-testid="text-layers-summary">
          {data.summary}
        </p>
      )}

      {!locked && (
        <button
          onClick={() => void findLayers()}
          disabled={finding}
          className="w-full rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
          data-testid="button-find-layers"
        >
          {finding ? (
            <span className="flex items-center justify-center gap-1.5">
              <Loader2 size={10} className="animate-spin" />
              Looking at the picture
            </span>
          ) : data.decomposed ? (
            <>Take it apart again {"·"} about $0.005</>
          ) : (
            <>Find the layers {"·"} about $0.005</>
          )}
        </button>
      )}
    </div>
  );
}
