/**
 * Phase 9 item 9 · stage 03 in its other medium.
 *
 * The spine does not gain a stage. Stage 03 gains a MEDIUM, because a separate
 * video stage would make one post look like two pipelines and the five stages
 * are fixed display order (doc 24 §3, Tony's own framing of the spine).
 *
 * **The still is never consumed.** Converting is additive: the image variant
 * stays exactly where it was and the motion points back at it, which is what
 * `sourceImageVariantId` records and what lets a channel take either medium
 * from one creative (doc 21 §4.5).
 *
 * **The distinction this panel exists to draw** is between a clip that IS this
 * still in motion and a clip that merely also exists for the same channel. Only
 * the lineage can tell those apart, and presenting them alike would offer
 * "image or video" as two formats of one idea when sometimes they are two
 * different ideas.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface MediumChoice {
  platform: string;
  imageVariantId: string | null;
  motionVariantId: string | null;
  motionFromThisImage: boolean;
}

interface MotionTake {
  videoUrl?: string;
  sourceImageUrl?: string;
  instruction?: string | null;
  durationSeconds?: number;
  /** What the clip actually cost, written by the server at billing time. */
  costUsd?: number;
  /**
   * Set when this take is a RENDERED CUT rather than one animated still.
   *
   * The cut takes this slot deliberately — it is the one thing ship reads for
   * a clip — but only one of them can ship, so the tab has to say which one is
   * sitting here. Calling a three-shot cut "a 6s clip" and offering "Animate
   * again" beside it would let somebody replace a whole sequence by pressing
   * the obvious button.
   */
  cut?: { sequenceId: string; shots: number } | null;
}

export function MotionPanel({
  creativeId,
  stageId,
  /** The current pick's image, or null when nothing is picked yet. */
  pickImageUrl,
  /** The current motion take's payload, when one exists. */
  motionTake,
  locked,
  onChanged,
  /** The shell's forward: same continue every stage has (doc 41 items 7/11). */
  onContinue,
  /** Switch to the Sequence tab beside this one (build step 1: it exists now). */
  onOpenSequence,
}: {
  creativeId: string;
  stageId: string;
  pickImageUrl: string | null;
  motionTake: MotionTake | null;
  locked: boolean;
  onChanged: () => void;
  onContinue?: () => void;
  onOpenSequence?: () => void;
}) {
  const [choices, setChoices] = useState<MediumChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();

  /*
   * The doorway to the Phase 9 timeline — sequences, multi-clip, multi-track
   * audio and voiceover — which was fully built and never linked from any
   * Studio surface (Tony asked where it went, 2026-08-11). One button: open
   * the creative's sequence if it has one, start one if it does not.
   */
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [sequenceBusy, setSequenceBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`);
        if (!res.ok || cancelled) return;
        const body = await res.json() as { sequences?: Array<{ id: string }> };
        if (!cancelled) setSequenceId(body.sequences?.[0]?.id ?? null);
      } catch { /* the button falls back to "start", which creates one */ }
    })();
    return () => { cancelled = true; };
  }, [creativeId]);

  async function openSequence() {
    if (sequenceBusy) return;
    // The Sequence tab exists now (build step 1): switching to it is the
    // doorway, and it creates the sequence itself when there is none. The
    // standalone /sequence/:id route stays as the fallback for surfaces
    // without the tab.
    if (onOpenSequence) { onOpenSequence(); return; }
    if (sequenceId) { navigate(`/sequence/${sequenceId}`); return; }
    setSequenceBusy(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { sequence?: { id: string }; error?: string } | null;
      if (res.ok && body?.sequence?.id) navigate(`/sequence/${body.sequence.id}`);
      else setError(body?.error ?? "The sequence could not be started.");
    } catch {
      setError("The sequence could not be started.");
    } finally {
      setSequenceBusy(false);
    }
  }

  /*
   * Animate the pick, from HERE. This tab used to hold one paragraph sending
   * people back to the legacy Co-pilot, because no stage route existed
   * (doc 40 P0.4). The route exists now; the paragraph is gone.
   */
  const [instruction, setInstruction] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  async function convert() {
    if (converting || locked || !pickImageUrl) return;
    setConverting(true);
    setConvertError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/stages/${stageId}/motion-convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(instruction.trim() ? { instruction: instruction.trim() } : {}),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setConvertError(body?.error ?? "The clip could not be made.");
        return;
      }
      setInstruction("");
      onChanged();
    } catch {
      setConvertError("The clip could not be reached. Nothing was charged.");
    } finally {
      setConverting(false);
    }
  }

  const motionIsStale = Boolean(
    motionTake?.videoUrl && pickImageUrl && motionTake.sourceImageUrl !== pickImageUrl,
  );

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/media`);
      if (!resp.ok) throw new Error(`The media for this creative could not be read (${resp.status}).`);
      const body = await resp.json();
      setChoices(body.choices ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The media for this creative could not be read.");
    }
  }, [creativeId]);

  useEffect(() => { void load(); }, [load]);

  const withMotion = (choices ?? []).filter(c => c.motionVariantId);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-start gap-3">
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
            Stage 03 · Motion
          </p>
          <h2 className="font-display text-xl tracking-wide text-foreground">
            The same stage, moving
          </h2>
          <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-foreground">
            Motion is a medium of this stage, not a stage of its own. Whatever is here was animated
            from a still that is still sitting under the Image tab, so switching back costs nothing.
          </p>
        </div>
        <button
          onClick={() => void openSequence()}
          disabled={sequenceBusy}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
          data-testid="button-open-sequence"
        >
          {sequenceBusy ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <>
              {sequenceId ? "Open the sequence" : "Start a sequence"}
              <ArrowRight size={9} />
            </>
          )}
        </button>
      </div>

      {error && (
        <p className="rounded-sm border border-destructive/50 bg-raised px-2.5 py-1.5 text-[12px] text-destructive">
          {error}
        </p>
      )}

      {motionTake?.videoUrl && (
        <div className="space-y-2">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            controls
            src={motionTake.videoUrl}
            className="max-h-[420px] rounded-sm border border-border bg-card"
            data-testid="motion-clip"
          />
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {motionTake.cut
                ? `The rendered cut ${"·"} ${motionTake.cut.shots} shot${motionTake.cut.shots === 1 ? "" : "s"}${
                    motionTake.durationSeconds ? ` ${"·"} ${motionTake.durationSeconds}s` : ""
                  }`
                : motionTake.durationSeconds ? `${motionTake.durationSeconds}s clip` : "Clip"}
              {!motionTake.cut && typeof motionTake.costUsd === "number" ? ` ${"·"} $${motionTake.costUsd.toFixed(2)}` : ""}
              {motionTake.instruction ? ` ${"·"} "${motionTake.instruction}"` : ""}
              {motionIsStale && (
                <span className="text-victory-gold">
                  {" "}Animated from an earlier pick, so it will not ship. Animate again to carry it.
                </span>
              )}
            </p>
            {/*
              The way on from a good clip. The clip already ships by itself —
              nothing needs pressing to carry it — but a surface with no forward
              reads as a dead end (doc 41 item 7), so the fact and the forward
              are one button.
            */}
            {!motionIsStale && onContinue && (
              <button
                onClick={onContinue}
                className="flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate"
                data-testid="button-motion-continue"
              >
                Ships with every channel version {"·"} continue
              </button>
            )}
          </div>
        </div>
      )}

      {!locked && (
        pickImageUrl ? (
          <div className="rounded-sm border border-border bg-card px-3 py-2.5">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void convert(); }
              }}
              rows={2}
              placeholder="slow push-in, the gold arcs crackle and flow"
              aria-label="How the clip should move. Leave empty for natural motion."
              className="w-full resize-none border-0 bg-transparent p-0 text-[13.5px] leading-snug text-foreground outline-none placeholder:text-dim"
              data-testid="input-motion-instruction"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`font-mono text-[8.5px] uppercase tracking-[0.06em] ${motionTake?.cut ? "text-victory-gold" : "text-dim"}`}>
                {motionTake?.cut
                  ? `Animating replaces the rendered cut as what ships ${"·"} the cut stays on the Sequence tab`
                  : "Animates the pick · billed per second of clip"}
                {!motionTake?.cut && typeof motionTake?.costUsd === "number" && motionTake.durationSeconds
                  ? ` ${"·"} last clip $${motionTake.costUsd.toFixed(2)} (${motionTake.durationSeconds}s)`
                  : ""}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => void convert()}
                disabled={converting}
                className="rounded-sm border border-grit-teal px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-cyber-teal hover-elevate disabled:opacity-40"
                data-testid="button-motion-convert"
              >
                {converting ? <Loader2 size={10} className="animate-spin" />
                  : motionTake?.cut ? "Animate the pick instead"
                  : motionTake?.videoUrl ? "Animate again"
                  : "Animate the pick"}
              </button>
            </div>
            {convertError && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-rebel-pink">{convertError}</p>
            )}
          </div>
        ) : (
          !motionTake?.videoUrl && (
            <div className="rounded-sm border border-border/60 bg-raised px-3 py-2.5">
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Pick a take on the Image tab first. Motion animates the pick, and nothing is picked yet.
              </p>
            </div>
          )
        )
      )}

      {withMotion.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {withMotion.map(choice => (
            <div key={choice.platform} className="rounded-sm border border-border bg-raised p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-foreground">{choice.platform}</span>
                <span
                  className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] ${
                    choice.motionFromThisImage
                      ? "border-grit-teal text-cyber-teal"
                      : "border-rebel-pink text-rebel-pink"
                  }`}
                >
                  {choice.motionFromThisImage ? "from this still" : "different take"}
                </span>
              </div>

              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {choice.motionFromThisImage
                  ? "This clip is the still in motion, so either medium ships the same post."
                  : choice.imageVariantId
                    /*
                      The case only the lineage can answer, and the reason this
                      panel is worth having. Unrecorded lineage lands here too:
                      not knowing and yes must not read the same.
                    */
                    ? "This clip came from a different take, so choosing motion ships a different picture rather than a moving version of the still."
                    : "There is a clip for this channel but no still beside it."}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
