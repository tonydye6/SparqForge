import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/utils";

/**
 * Stage 03 · Refine · the layer list, fetched once for two views.
 *
 * WHY THIS IS A HOOK AND NOT STATE INSIDE THE PANEL. Tony walked 5c and found
 * "nothing appeared to happen" when he pressed Find the layers. The cause was
 * real: the panel reloaded on a key derived from the TAKE COUNT, and detection
 * writes `take_layers` rows without creating a take, so the key never changed
 * and the fetch never re-ran. The rows were in the database and the panel had no
 * way to learn it.
 *
 * So reloading is now something this hook does on demand rather than something
 * inferred from a number that happens to change most of the time. And the list
 * lives above both the inspector and the image, because a layer has to be
 * hoverable in the picture as well as listed beside it, and two copies of the
 * same fetch would drift.
 *
 * THE TAKE-COUNT KEY IS GONE, not merely supplemented. It survived as a
 * `revision` parameter beside the nonce, and doc 46 §4 found the hole it left:
 * RESTORING an earlier take flips `isCurrent` without creating a take, so the
 * count did not change either, and the panel went on drawing the old take's
 * boxes on a different picture. Every mutation now calls `reload()`, which is
 * what this docstring claimed before it was true.
 */

export interface Layer {
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

export interface LayersResponse {
  slotKey: string;
  takeId: string;
  imageUrl: string | null;
  layers: Layer[];
  decomposed: boolean;
  knownCount: number;
  inheritedCount: number;
  locatedCount: number;
  summary: string;
  /**
   * The two prices, from the server that charges them.
   *
   * Both buttons used to carry hand-typed numbers that were already wrong —
   * $0.005 against $0.004, $0.13 against $0.134 — and both estimates are
   * env-overridable, so a typed label cannot stay true (doc 46 §5).
   */
  detectCostUsd: number;
  /** One image edit, whatever scoped it: a layer, a drawn box, or the whole take. */
  editCostUsd: number;
}

/** The layer id behind the read model's `layer:<id>` key, or null for the cast. */
export function layerIdOf(key: string): string | null {
  return key.startsWith("layer:") ? key.slice("layer:".length) : null;
}

export function useTakeLayers(creativeId: string, stageId: string, slotKey: string) {
  const [data, setData] = useState<LayersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  /** Call after anything that changes the layer rows or the current take. */
  const reload = useCallback(() => setNonce((n) => n + 1), []);

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
  }, [creativeId, stageId, slotKey, nonce]);

  /** Only located layers can be drawn on the image or scoped to. */
  const located = (data?.layers ?? []).filter(
    (l): l is Layer & { bbox: NonNullable<Layer["bbox"]> } => l.bbox !== null && l.kind !== "base",
  );

  return { data, error, reload, located };
}
