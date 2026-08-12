import { useEffect, useState } from "react";
import { Loader2, Pin } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { InfoDot } from "@/components/studio/InfoDot";

/**
 * Stage 03 · Refine · what this take is made of, and changing one part of it.
 *
 * The layer list lives in the inspector column beside the deck, not on the
 * canvas: doc 38 §3 — the grid is pictures, the inspector is words. A layer row
 * is a thumbnail and a NAME, because a decomposition whose rows are called
 * "layer 2" tells you nothing (doc 45 §1.1).
 *
 * Two honesty rules this panel carries, both learned by walking it:
 *  · a KNOWN layer is one we know is in the picture, from which authoritative
 *    file — not one we know the position of. Rows with no box say NOT LOCATED
 *    and cannot be selected, because a guessed box would scope an edit to the
 *    wrong pixels.
 *  · a CARRIED FORWARD row came from the take this one was edited from, so an
 *    edit since could have changed it. Detection is what settles that.
 *
 * Selecting a located layer opens a one-line composer for that layer alone.
 * There is no separate "layer editor": the edit goes through the same
 * region-edit path as a drawn box, so the drift report proves what it claims.
 */

interface Layer {
  key: string;
  name: string;
  kind: "base" | "subject" | "mark" | "element" | "device" | "typography" | "character" | "background";
  origin: "known_cast" | "inherited_cast" | "detected";
  assetId: string | null;
  assetName: string | null;
  thumbnailUrl: string | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  pinned: boolean;
  note: string | null;
}

interface LayersResponse {
  slotKey: string;
  takeId: string;
  imageUrl: string | null;
  layers: Layer[];
  decomposed: boolean;
  knownCount: number;
  inheritedCount: number;
  locatedCount: number;
  summary: string;
}

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
  /** Bumped by the deck whenever a take changes, so the list re-reads. */
  revision: number;
  /** A layer edit makes a new take, so the deck has to reload. */
  onEdited: () => void;
}

/** The layer id is the suffix of the read model's `layer:<id>` key. */
const layerIdOf = (key: string): string | null =>
  key.startsWith("layer:") ? key.slice("layer:".length) : null;

export function LayerPanel({ creativeId, stageId, slotKey, locked, revision, onEdited }: LayerPanelProps) {
  const [data, setData] = useState<LayersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [sending, setSending] = useState(false);
  const [drift, setDrift] = useState<{ layerName: string; drift: Drift | null; unavailable: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    void apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/layers?slotKey=${encodeURIComponent(slotKey)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (LayersResponse & { error?: string }) | null;
        if (!live) return;
        if (!res.ok) {
          setError(body?.error ?? "This take could not be taken apart.");
          setData(null);
          return;
        }
        setData(body);
      })
      .catch(() => {
        if (live) setError("The layers could not be reached.");
      });
    return () => { live = false; };
  }, [creativeId, stageId, slotKey, revision]);

  async function findLayers() {
    if (finding || locked) return;
    setFinding(true);
    setError(null);
    setDrift(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/detect-layers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "This picture could not be taken apart.");
        return;
      }
      onEdited();
    } catch {
      setError("That could not be reached. Nothing was charged.");
    } finally {
      setFinding(false);
    }
  }

  async function editLayer(layerId: string) {
    const text = instruction.trim();
    if (!text || sending || locked) return;
    setSending(true);
    setError(null);
    setDrift(null);
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
        setError(body?.error ?? "That change could not be made.");
        return;
      }
      setInstruction("");
      setSelected(null);
      setDrift({
        layerName: body?.layerName ?? "that layer",
        drift: body?.drift ?? null,
        unavailable: body?.driftUnavailable ?? null,
      });
      onEdited();
    } catch {
      setError("That change could not be reached. Nothing was charged.");
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

      {error && (
        <p className="text-[10.5px] leading-relaxed text-rebel-pink">{error}</p>
      )}

      {data.layers.map((l) => {
        const id = layerIdOf(l.key);
        const selectable = !locked && id !== null && l.kind !== "base";
        const isSelected = selected === id;
        return (
          <div key={l.key}>
            <button
              type="button"
              onClick={() => selectable && setSelected(isSelected ? null : id)}
              disabled={!selectable}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm border p-1.5 text-left",
                isSelected ? "border-grit-teal bg-grit-teal/5" : l.bbox ? "border-border/60" : "border-border/30",
                selectable && "hover-elevate",
              )}
              data-testid={`row-layer-${l.kind}`}
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-border/60 bg-card">
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
                    if (e.key === "Escape") { setSelected(null); setInstruction(""); }
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

      <p className="pt-1 text-[10.5px] leading-relaxed text-dim" data-testid="text-layers-summary">
        {data.summary}
      </p>

      {!locked && (
        <button
          onClick={() => void findLayers()}
          disabled={finding}
          className="w-full rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
          data-testid="button-find-layers"
        >
          {finding ? (
            <Loader2 size={10} className="mx-auto animate-spin" />
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
