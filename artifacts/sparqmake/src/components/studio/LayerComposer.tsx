import { useRef, useState } from "react";
import { Loader2, Move, Sparkles } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { MentionChips, MentionPickerList, reconcile, useMentions, type AssetOption } from "@/components/studio/mentions";

/**
 * Stage 03 · Refine · the prompt box attached to a selected layer.
 *
 * Tony, 2026-08-12, from Higgsfield's own layer panel: the box to edit a layer
 * belongs "right below the layer" — on the picture, under the thing being
 * changed — not in a side panel. Doc 45 §1.2 called this the key interaction and
 * it is: the composer sitting on the element is what makes the scope obvious
 * without a sentence explaining it.
 *
 * It carries `@` for the same reason every other composer does (doc 41 item 3):
 * a mention is a mention wherever it is typed, and "give her @Crown U primary"
 * silently doing nothing in one box and working in another is the exact
 * inconsistency that gate exists to prevent. The server applies the same
 * eligibility check and names any refusal.
 *
 * MOVING. When a destination has been dragged, the action becomes a move, and a
 * move is honest about what it is: one generative pass that draws the element in
 * its new place and reconstructs whatever belongs where it used to be. Those
 * pixels never existed, so the caveat travels with the result rather than being
 * left for somebody to notice.
 */

export interface Drift {
  driftPercent: number;
  verdict: "clean" | "notable" | "repainted";
  message: string;
}

interface LayerComposerProps {
  creativeId: string;
  stageId: string;
  slotKey: string;
  brandId: string | null;
  layerId: string;
  layerName: string;
  /** Dragged destination, when the layer has been pulled somewhere new. */
  moveTo: { x: number; y: number } | null;
  /**
   * What this costs, from the read model that charges it. Hand-typed here as
   * "$0.13" against an actual, env-overridable $0.134 (doc 46 §5).
   */
  costUsd: number;
  /** Anchored above its layer instead of below, near the bottom of the frame. */
  flipped: boolean;
  onCancelMove: () => void;
  onDone: (result: { layerName: string; drift: Drift | null; unavailable: string | null; caveat: string | null }) => void;
  onClose: () => void;
}

export function LayerComposer({
  creativeId,
  stageId,
  slotKey,
  brandId,
  layerId,
  layerName,
  moveTo,
  costUsd,
  flipped,
  onCancelMove,
  onDone,
  onClose,
}: LayerComposerProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Array<{ name?: string; reason?: string }>>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const m = useMentions(brandId);

  function chooseMention(asset: AssetOption) {
    const el = inputRef.current;
    const caret = el ? el.selectionStart : instruction.length;
    const r = m.choose(asset, instruction, caret);
    if (!r) return;
    setInstruction(r.line);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  }

  /* A move needs no words; a restyle is nothing without them. */
  const canSubmit = moveTo !== null || instruction.trim().length > 0;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    setDropped([]);
    try {
      const text = instruction.trim();
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/region-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotKey,
          layerId,
          ...(moveTo ? { moveTo } : {}),
          /*
           * Only what was actually typed. This used to fall back to
           * `move the <layerName>` so the field could stay required, which put
           * words in the history deck nobody typed and pushed the layer's name
           * into a prompt that composes its own sentence (doc 46 §7.1).
           */
          ...(text ? { instruction: text } : {}),
          mentions: reconcile(m.mentions, text),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        layerName?: string;
        drift?: Drift | null;
        driftUnavailable?: string | null;
        moveCaveat?: string | null;
        droppedMentions?: Array<{ name?: string; reason?: string }>;
      } | null;
      if (!res.ok) {
        setError(body?.error ?? "That change could not be made.");
        return;
      }
      if (Array.isArray(body?.droppedMentions) && body.droppedMentions.length > 0) {
        setDropped(body.droppedMentions);
      }
      setInstruction("");
      m.setMentions([]);
      onDone({
        layerName: body?.layerName ?? layerName,
        drift: body?.drift ?? null,
        unavailable: body?.driftUnavailable ?? null,
        caveat: body?.moveCaveat ?? null,
      });
      onClose();
    } catch {
      setError("That change could not be reached. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "w-[min(320px,80vw)] rounded-sm border border-grit-teal bg-card/95 p-2 shadow-lg backdrop-blur-sm",
        flipped ? "mb-2" : "mt-2",
      )}
      /* The frame's drag must not start under this box, or typing in it would
         also draw a selection behind it. */
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="composer-layer"
    >
      <p className="mb-1 flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.06em] text-cyber-teal">
        {moveTo ? <Move size={9} /> : <Sparkles size={9} />}
        {layerName}
      </p>

      <div className="relative">
        <textarea
          ref={inputRef}
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
            if (m.onKeyDown(e)) return;
            if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
          }}
          rows={2}
          autoFocus
          placeholder={moveTo ? `anything else about ${layerName.toLowerCase()}?` : `change only ${layerName.toLowerCase()}`}
          aria-label={moveTo ? `Move ${layerName}, and optionally say more` : `Change ${layerName} and nothing else`}
          aria-expanded={m.picker !== null}
          aria-controls={m.picker ? "layer-mention-picker" : undefined}
          className="w-full resize-none border-0 bg-transparent p-0 text-[12.5px] leading-snug text-foreground outline-none placeholder:text-dim"
          data-testid="input-layer-instruction"
        />
        <MentionPickerList m={m} pickerId="layer-mention-picker" onChoose={chooseMention} />
      </div>
      <MentionChips mentions={m.mentions} />

      {error && <p className="mt-1 text-[10.5px] leading-relaxed text-rebel-pink">{error}</p>}
      {dropped.length > 0 && (
        <p className="mt-1 text-[10.5px] leading-relaxed text-victory-gold">
          Not used: {dropped.map((d) => `${d.name ?? "an attachment"} — ${(d.reason ?? "not eligible").toLowerCase()}`).join("; ")}
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-2">
        <span className="font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
          {moveTo
            ? <>Moves it {"·"} fills the gap {"·"} ${costUsd.toFixed(3)}</>
            : <>This layer only {"·"} @ attaches {"·"} ${costUsd.toFixed(3)}</>}
        </span>
        <div className="flex-1" />
        {moveTo && (
          <button
            onClick={onCancelMove}
            disabled={busy}
            className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
            data-testid="button-layer-move-cancel"
          >
            Put it back
          </button>
        )}
        <button
          onClick={() => void submit()}
          disabled={!canSubmit || busy}
          className="rounded-sm border border-grit-teal px-2 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.06em] text-cyber-teal hover-elevate disabled:opacity-40"
          data-testid="button-layer-submit"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : moveTo ? "Move it here" : "Change it"}
        </button>
      </div>
    </div>
  );
}
