import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * Stage 03 · Media · the storyboard sheet (the story path, step 4b).
 *
 * The spread turned 90 degrees: a column is a BEAT, not a composition. Two
 * takes per beat, because a beat is one moment and the only thing left to vary
 * is how it is framed.
 *
 * **Each beat runs alone, and that is the whole point.** Tony asked for exactly
 * this — "what if I only like one" — so a pick LOCKS its beat against every
 * later run, and any unpicked beat re-runs on its own with an optional steering
 * sentence. Nobody ever re-pays for a moment they kept.
 *
 * Everything arguable is decided on the server: which beats are locked, what one
 * more beat costs, and whether this post is a story at all. This draws it.
 */

interface BeatTake {
  slotKey: string;
  variant: string;
  imageUrl: string | null;
  takeIndex: number;
  history: number;
  framing: string | null;
}

interface BeatClip {
  videoUrl: string;
  durationSeconds: number | null;
  costUsd: number | null;
  engine: string;
  /** Set when this shot began on the previous beat's final frame. */
  chainedFrom: string | null;
  /** Set when a chain was asked for and could not be made, with the reason. */
  chainRefused: string | null;
  /** Set when this shot was pinned to end on the next moment (routed to Veo). */
  endPinned: boolean;
  endPinRefused: string | null;
  /** Set when the pinning model was asked for and could not deliver. */
  routeFellBack: string | null;
}

interface Beat {
  n: number;
  text: string;
  takes: BeatTake[];
  picked: { slotKey: string; imageUrl: string | null } | null;
  clip: BeatClip | null;
  locked: boolean;
  empty: boolean;
}

interface Storyboard {
  shape: "single" | "sequence";
  stageId: string;
  stageStatus: string;
  beats: Beat[];
  takesPerBeat: number;
  beatCostUsd: number;
  pickedCount: number;
  animatedCount: number;
  unpickedCount: number;
  unrunCount: number;
  summary: string;
  /** Which engine rendered the beats — routing disclosed, not chosen from a menu. */
  renderedBy: string | null;
}

export function StoryboardSheet({
  creativeId,
  stageId,
  locked,
  onChanged,
  onContinue,
}: {
  creativeId: string;
  stageId: string;
  locked: boolean;
  onChanged: () => void;
  onContinue?: () => void;
}) {
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which beat is generating. One at a time, so a price is never ambiguous. */
  const [running, setRunning] = useState<number | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [steering, setSteering] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(null);
  /** Which beat is animating. Priced per second, so one at a time. */
  const [animating, setAnimating] = useState<number | null>(null);
  /**
   * Whether each beat starts on the previous shot's final frame.
   *
   * On by default for every beat after the first, because continuity is what a
   * sequence is FOR — a story whose shots do not flow is three posts. Turning it
   * off is one press and the take records which it did.
   */
  const [chain, setChain] = useState<Record<number, boolean>>({});
  /**
   * Whether each beat ends on the NEXT beat's picked still.
   *
   * OFF by default, and the one control that routes: a pinned end frame needs a
   * model that accepts one, so asking for it changes the engine. Off by default
   * because it is a stronger claim about the shot than continuity is, and it is
   * only offered when the next beat actually has a pick to end on.
   */
  const [endPin, setEndPin] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/storyboard`);
      if (!res.ok) throw new Error(String(res.status));
      setBoard((await res.json()) as Storyboard);
    } catch {
      setError("The storyboard could not be read.");
    }
  }, [creativeId]);

  useEffect(() => { void load(); }, [load]);

  async function runBeat(n: number) {
    if (running !== null || locked) return;
    setRunning(n);
    setError(null);
    setNote(null);
    try {
      const body: Record<string, unknown> = { beat: n };
      const steer = (steering[n] ?? "").trim();
      if (steer) body.steering = steer;
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/explore-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => null)) as { error?: string; costCents?: number } | null;
      if (!res.ok) {
        setError(out?.error ?? "That beat could not be run.");
        return;
      }
      if (typeof out?.costCents === "number") setNote(`Beat ${n} run · $${(out.costCents / 100).toFixed(2)}`);
      await load();
      onChanged();
    } catch {
      setError("That beat could not be reached. Nothing was charged.");
    } finally {
      setRunning(null);
    }
  }

  async function pick(beat: number, slotKey: string) {
    if (picking || locked) return;
    setPicking(slotKey);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/use-take`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, beat }),
      });
      const out = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(out?.error ?? "That take could not be used.");
        return;
      }
      await load();
      onChanged();
    } catch {
      setError("That take could not be used.");
    } finally {
      setPicking(null);
    }
  }

  /**
   * Animate one beat into the cut.
   *
   * The clip goes to the post's sequence, so the storyboard and the Sequence tab
   * are the same cut seen twice rather than two piles of clips. The sequence is
   * created on first use — a story always ends up needing one.
   */
  async function animateBeat(n: number) {
    if (animating !== null || locked) return;
    setAnimating(n);
    setError(null);
    setNote(null);
    try {
      let sequenceId: string | null = null;
      const listRes = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`);
      if (listRes.ok) {
        const body = (await listRes.json()) as { sequences?: Array<{ id: string }> };
        sequenceId = body.sequences?.[0]?.id ?? null;
      }
      if (!sequenceId) {
        const madeRes = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`, { method: "POST" });
        const made = (await madeRes.json().catch(() => null)) as { sequence?: { id: string } } | null;
        sequenceId = made?.sequence?.id ?? null;
      }
      if (!sequenceId) {
        setError("The cut this shot belongs to could not be started, so nothing was charged.");
        return;
      }

      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/stages/${stageId}/motion-convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beat: n,
          sequenceId,
          chainFromPreviousBeat: n > 1 && (chain[n] ?? true),
          endOnNextBeat: endPin[n] === true,
        }),
      });
      const out = (await res.json().catch(() => null)) as {
        error?: string;
        costUsd?: number;
        engine?: string;
        endPinRefused?: string | null;
        routeFellBack?: string | null;
      } | null;
      if (!res.ok) {
        setError(out?.error ?? "That shot could not be animated.");
        return;
      }
      if (typeof out?.costUsd === "number") {
        setNote(`Beat ${n} animated · $${out.costUsd.toFixed(2)} · ${out.engine ?? "omni"}`);
      }
      // Said out loud rather than left to be noticed: a pin that could not be
      // honoured, and a route that had to fall back.
      if (out?.endPinRefused) setError(`Did not pin the end: ${out.endPinRefused}.`);
      else if (out?.routeFellBack) setError(`The pinning model could not render this shot, so it was made without the end pin. ${out.routeFellBack}`);
      await load();
      onChanged();
    } catch {
      setError("That shot could not be animated. Nothing was charged.");
    } finally {
      setAnimating(null);
    }
  }

  if (!board) {
    return <div className="mx-auto max-w-5xl p-6"><p className="text-[12px] text-dim">Reading the storyboard…</p></div>;
  }

  const price = `$${board.beatCostUsd.toFixed(2)}`;
  const allPicked = board.unpickedCount === 0 && board.beats.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="space-y-1">
        <p className="ui-label text-grit-teal">
          Stage 03 {"·"} Media {"·"} Storyboard
        </p>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-display text-xl tracking-wide text-foreground">The shots</h2>
          <span className="ui-label text-dim">
            {board.beats.length} beats {"·"} same subject pinned in every one
          </span>
        </div>
      </div>

      {error && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-rebel-pink">
          {error}
        </p>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {board.beats.map((beat) => (
          <div
            key={beat.n}
            className={cn(
              "flex flex-col overflow-hidden rounded-sm border bg-card",
              beat.locked ? "border-grit-teal" : "border-border",
            )}
            data-testid={`beat-${beat.n}`}
          >
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
              {beat.locked && <span className="size-[6px] shrink-0 rounded-full bg-cyber-teal" />}
              <span className="min-w-0 flex-1 truncate ui-label text-foreground" title={beat.text}>
                {beat.n} {"·"} {beat.text}
              </span>
              {beat.locked && (
                <span className="shrink-0 ui-label text-cyber-teal">Kept</span>
              )}
              {running === beat.n && (
                <span className="shrink-0 ui-label text-victory-gold">Running</span>
              )}
            </div>

            <div className="flex gap-1.5 p-2">
              {running === beat.n && beat.takes.length === 0 &&
                Array.from({ length: board.takesPerBeat }, (_, i) => (
                  <span key={i} className="flex aspect-square flex-1 items-center justify-center rounded-sm border border-border bg-raised">
                    <Loader2 size={14} className="animate-spin text-cyber-teal" />
                  </span>
                ))}

              {beat.takes.length === 0 && running !== beat.n && (
                <p className="px-1 py-3 text-[11px] leading-relaxed text-dim">
                  Not run yet.
                </p>
              )}

              {beat.takes.map((t) => {
                const isPick = beat.picked?.slotKey === t.slotKey;
                return (
                  <button
                    key={t.slotKey}
                    onClick={() => !beat.locked && void pick(beat.n, t.slotKey)}
                    disabled={locked || beat.locked || picking !== null || !t.imageUrl}
                    title={t.framing ?? t.slotKey}
                    className={cn(
                      "relative aspect-square flex-1 overflow-hidden rounded-sm border",
                      isPick ? "border-2 border-grit-teal" : "border-border",
                      beat.locked && !isPick ? "opacity-35" : "",
                      !beat.locked && !locked ? "hover-elevate" : "",
                    )}
                    data-testid={`beat-${beat.n}-take-${t.variant}`}
                  >
                    {t.imageUrl && <img src={t.imageUrl} alt="" className="h-full w-full object-cover" />}
                    {isPick && (
                      <span className="absolute left-1 top-1 rounded-sm bg-black/60 px-1 py-px ui-label text-cyber-teal">
                        in use
                      </span>
                    )}
                    {picking === t.slotKey && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 size={14} className="animate-spin text-cyber-teal" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-auto border-t border-border px-2 py-1.5">
              {beat.locked ? (
                <div className="space-y-1.5">
                  <p className="text-[10.5px] leading-relaxed text-dim">
                    Locked by your pick. No run touches it.
                  </p>

                  {beat.clip ? (
                    <>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        controls
                        src={beat.clip.videoUrl}
                        className="w-full rounded-sm border border-border bg-background"
                        data-testid={`beat-${beat.n}-clip`}
                      />
                      <p className="ui-label text-dim">
                        {beat.clip.durationSeconds ? `${beat.clip.durationSeconds}s` : "clip"}
                        {beat.clip.costUsd !== null ? ` ${"·"} $${beat.clip.costUsd.toFixed(2)}` : ""}
                        {" · "}{beat.clip.engine}
                        {beat.clip.chainedFrom ? ` ${"·"} starts on beat ${beat.n - 1}'s final frame` : ""}
                        {beat.clip.endPinned ? ` ${"·"} ends on beat ${beat.n + 1}'s still` : ""}
                      </p>
                      {beat.clip.chainRefused && (
                        <p className="text-[10px] leading-relaxed text-victory-gold">
                          Did not chain: {beat.clip.chainRefused}.
                        </p>
                      )}
                      {beat.clip.endPinRefused && (
                        <p className="text-[10px] leading-relaxed text-victory-gold">
                          Did not pin the end: {beat.clip.endPinRefused}.
                        </p>
                      )}
                      {beat.clip.routeFellBack && (
                        <p className="text-[10px] leading-relaxed text-victory-gold">
                          Made without the end pin {"—"} the pinning model could not render it.
                        </p>
                      )}
                    </>
                  ) : null}

                  {!locked && (
                    <>
                      {beat.n > 1 && (
                        <button
                          onClick={() => setChain((c) => ({ ...c, [beat.n]: !(c[beat.n] ?? true) }))}
                          aria-pressed={chain[beat.n] ?? true}
                          className={cn(
                            "w-full rounded-sm border px-1.5 py-1 text-[12px] font-medium hover-elevate",
                            (chain[beat.n] ?? true)
                              ? "border-grit-teal bg-grit-teal/10 text-cyber-teal"
                              : "border-border text-muted-foreground",
                          )}
                          data-testid={`button-chain-beat-${beat.n}`}
                        >
                          Start from beat {beat.n - 1}{"'"}s final frame
                        </button>
                      )}
                      {board.beats.some((b) => b.n === beat.n + 1 && b.locked) && (
                        <button
                          onClick={() => setEndPin((c) => ({ ...c, [beat.n]: !c[beat.n] }))}
                          aria-pressed={endPin[beat.n] === true}
                          className={cn(
                            "w-full rounded-sm border px-1.5 py-1 text-[12px] font-medium hover-elevate",
                            endPin[beat.n]
                              ? "border-victory-gold bg-victory-gold/10 text-victory-gold"
                              : "border-border text-muted-foreground",
                          )}
                          data-testid={`button-endpin-beat-${beat.n}`}
                        >
                          End on beat {beat.n + 1}{"'"}s still
                        </button>
                      )}
                      <button
                        onClick={() => void animateBeat(beat.n)}
                        disabled={animating !== null}
                        className="w-full rounded-sm border border-victory-gold/60 px-2 py-1 text-[12px] font-medium text-victory-gold hover-elevate disabled:opacity-40"
                        data-testid={`button-animate-beat-${beat.n}`}
                      >
                        {animating === beat.n
                          ? <Loader2 size={9} className="mx-auto animate-spin" />
                          : beat.clip
                            ? <>Animate again {"·"} replaces this shot</>
                            : <>Animate this shot {"·"} per second</>}
                      </button>
                    </>
                  )}
                </div>
              ) : locked ? (
                <p className="text-[10.5px] leading-relaxed text-dim">The stage is locked.</p>
              ) : (
                <div className="space-y-1.5">
                  <input
                    value={steering[beat.n] ?? ""}
                    onChange={(e) => setSteering((s) => ({ ...s, [beat.n]: e.target.value }))}
                    placeholder="steer it (optional)"
                    aria-label={`Steer beat ${beat.n}`}
                    className="w-full rounded-sm border border-border bg-raised px-1.5 py-1 text-[10.5px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal"
                  />
                  <button
                    onClick={() => void runBeat(beat.n)}
                    disabled={running !== null}
                    className="w-full rounded-sm border border-grit-teal px-2 py-1 text-[12px] font-medium text-cyber-teal hover-elevate disabled:opacity-40"
                    data-testid={`button-run-beat-${beat.n}`}
                  >
                    {running === beat.n
                      ? <Loader2 size={9} className="mx-auto animate-spin" />
                      : <>{beat.empty ? "Run this beat" : "Run it again"} {"·"} {price}</>}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 rounded-sm border border-border bg-card px-3 py-2.5">
        <span className="text-[12px] text-foreground" data-testid="text-storyboard-summary">
          {board.summary}
        </span>
        {note && <span className="ui-label text-cyber-teal">{note}</span>}
        {board.renderedBy && (
          <span className="ui-label text-dim">
            {board.animatedCount} animated {"·"} rendered by {board.renderedBy}
          </span>
        )}
        <div className="flex-1" />
        {!locked && board.unrunCount > 0 && (
          <button
            onClick={() => {
              const next = board.beats.find((b) => b.empty && !b.locked);
              if (next) void runBeat(next.n);
            }}
            disabled={running !== null}
            className="rounded-sm border border-victory-gold/60 px-2.5 py-1 text-[12px] font-medium text-victory-gold hover-elevate disabled:opacity-40"
            data-testid="button-run-next-beat"
          >
            Run the next unrun beat {"·"} {price}
          </button>
        )}
        {allPicked && onContinue && (
          <button
            onClick={onContinue}
            className="flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover-elevate"
            data-testid="button-storyboard-continue"
          >
            Continue {"·"} animate the beats <ArrowRight size={9} />
          </button>
        )}
      </div>
    </div>
  );
}
