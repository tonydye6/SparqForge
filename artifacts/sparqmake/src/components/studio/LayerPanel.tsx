import { useEffect, useState } from "react";
import { Pin } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { InfoDot } from "@/components/studio/InfoDot";

/**
 * Stage 03 · Refine · what this take is made of.
 *
 * The layer list lives in the inspector column beside the deck, not on the
 * canvas: doc 38 §3 — the grid is pictures, the inspector is words. A layer row
 * is a thumbnail and a NAME, because a decomposition whose rows are called
 * "layer 2" tells you nothing (doc 45 §1.1).
 *
 * The honesty this panel has to carry: a KNOWN layer is one we know is in the
 * picture, from which authoritative file — not one we know the position of.
 * Rows with no box say so and draw no selection on the image, because a guessed
 * box would scope an edit to the wrong pixels.
 */

interface Layer {
  key: string;
  name: string;
  kind: "base" | "subject" | "mark" | "element";
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

interface LayerPanelProps {
  creativeId: string;
  stageId: string;
  slotKey: string;
  /** Bumped by the deck whenever a take changes, so the list re-reads. */
  revision: number;
}

export function LayerPanel({ creativeId, stageId, slotKey, revision }: LayerPanelProps) {
  const [data, setData] = useState<LayersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error) {
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

      {data.layers.map((l) => (
        <div
          key={l.key}
          className={cn(
            "flex items-center gap-2 rounded-sm border p-1.5",
            l.bbox ? "border-border/60" : "border-border/30",
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
            <p className="truncate font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
              {l.kind}
              {l.origin === "inherited_cast" && <> {"·"} carried forward</>}
              {!l.bbox && <> {"·"} not located</>}
            </p>
          </div>
        </div>
      ))}

      <p className="pt-1 text-[10.5px] leading-relaxed text-dim" data-testid="text-layers-summary">
        {data.summary}
      </p>
    </div>
  );
}
