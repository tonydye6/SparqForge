import { useCallback, useEffect, useState } from "react";
import { apiFetch, cn } from "@/lib/utils";

/**
 * Phase 6 · deciding, from the artifact.
 *
 * The old Review Queue was a separate page you had to go to, and its Approve
 * button 400'd by design. The decision was to dissolve it and keep the
 * taxonomy, so the decision now happens where the work is: directly under the
 * thing being judged.
 *
 * Three rules this surface exists to make true:
 *
 *  - **Sending back has to say why.** The seven categories are not decoration.
 *    Picking one points the note at the stage that caused it, and that note is
 *    waiting there when somebody reopens it.
 *  - **The suggested stage is a SUGGESTION.** It is pre-selected and always
 *    changeable, and two categories deliberately suggest nothing because they
 *    genuinely come from more than one place.
 *  - **A person who cannot act is told why**, rather than shown a dead button.
 *    A viewer who sees a greyed-out control and no explanation concludes the
 *    product is broken.
 */

interface Category {
  slug: string;
  label: string;
  description: string;
  suggests: string | null;
}

interface StageOption {
  id: string;
  stageNumber: number;
  stageKind: string;
  status: string;
  label: string;
}

interface Note {
  id: string;
  stageStateId: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface TeamState {
  creativeStatus: string;
  approval: {
    state: "none" | "awaiting" | "approved" | "needs_work";
    needsYou: boolean;
    summary: string;
    latest: { id: string; rejectStageStateId: string | null } | null;
  };
  commentsByStage: Record<string, { open: Note[]; resolved: Note[]; summary: string }>;
  stages: StageOption[];
  taxonomy: Category[];
  you: { id: string; role: string; canDecide: boolean; canRequest: boolean; explanation: string };
}

export function ReviewBar({
  creativeId,
  activeStageId,
  onDecided,
  /**
   * Bumped by the shell whenever anything upstream changed the post.
   *
   * Shipping can RESET an approval, because the decision covered content that
   * shipping replaced. Without this the bar sat there still reading "approved
   * and scheduled" beside a publishing bar that had just said the opposite.
   */
  revision,
}: {
  creativeId: string;
  activeStageId: string | null;
  onDecided?: () => void;
  revision: number;
}) {
  const [state, setState] = useState<TeamState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [why, setWhy] = useState<string>("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/team`);
      if (res.ok) setState(await res.json());
    } catch {
      /* leave the last good state rather than blanking the bar */
    }
  }, [creativeId]);

  useEffect(() => { void load(); }, [load, revision]);

  /*
   * The suggestion is asked for when a category is picked, not precomputed.
   * It depends on which stages have actually run, and that changes underneath
   * this component as somebody works.
   */
  async function pickReason(slug: string) {
    setReason(slug);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/team/suggest?reason=${encodeURIComponent(slug)}`);
      if (res.ok) {
        const out = await res.json();
        setStageId(out.stageStateId ?? null);
        setWhy(out.why ?? "");
      }
    } catch {
      setStageId(null);
      setWhy("");
    }
  }

  async function request() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/approvals`, { method: "POST" });
      const out = await res.json();
      if (!res.ok) { setError(out?.error ?? "That could not be requested."); return; }
      await load();
    } finally { setBusy(false); }
  }

  async function decide(decision: "approved" | "needs_work") {
    const approvalId = state?.approval.latest?.id;
    if (!approvalId || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/approvals/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          decision === "approved"
            ? { decision }
            : { decision, reason, stageStateId: stageId, note: note.trim() || null },
        ),
      });
      const out = await res.json();
      if (!res.ok) { setError(out?.error ?? "That decision could not be saved."); return; }
      setOpen(false); setReason(null); setStageId(null); setNote(""); setWhy("");
      await load();
      onDecided?.();
    } finally { setBusy(false); }
  }

  if (!state) return null;

  const { approval, you } = state;
  const stageNotes = activeStageId ? state.commentsByStage[activeStageId] : undefined;
  const canAct = you.canDecide;

  return (
    <div className="shrink-0 border-t border-border/60 bg-card">
      {/*
        Notes waiting on THIS stage, above the decision row.

        This is the payoff of anchoring a comment to a stage rather than to a
        creative: reopening Direction surfaces what was said about Direction,
        at the moment somebody is about to change it.
      */}
      {stageNotes && stageNotes.open.length > 0 && (
        <div className="border-b border-border/60 px-4 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-victory-gold">
            {stageNotes.summary}
          </p>
          <ul className="mt-1 space-y-1">
            {stageNotes.open.map((n) => (
              <li key={n.id} className="flex items-baseline gap-2 text-[11.5px] leading-relaxed">
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                  {n.authorName ?? "Someone"}
                </span>
                <span className="text-foreground">{n.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.11em] text-grit-teal">Review</span>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
          {approval.summary}
          {/* Never let a viewer conclude the product is broken. */}
          {!canAct && <span className="ml-2 text-dim">{you.explanation}</span>}
        </p>

        {approval.state === "none" || approval.state === "needs_work" || approval.state === "approved" ? (
          you.canRequest && (
            <button
              type="button" onClick={() => void request()} disabled={busy}
              className="shrink-0 rounded-sm border border-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate disabled:opacity-50"
            >
              Ask for a decision
            </button>
          )
        ) : canAct ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button" onClick={() => { setOpen(v => !v); setError(null); }} disabled={busy}
              className={cn(
                "rounded-sm border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.09em] hover-elevate disabled:opacity-50",
                open ? "border-victory-gold text-victory-gold" : "border-border text-muted-foreground",
              )}
            >
              Needs work
            </button>
            <button
              type="button" onClick={() => void decide("approved")} disabled={busy}
              className="rounded-sm bg-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        ) : null}
      </div>

      {error && (
        <p className="border-t border-rebel-pink/30 px-4 py-2 text-[11.5px] text-rebel-pink">{error}</p>
      )}

      {/*
        The taxonomy, anchored under the button that opened it. Sending work
        back without saying why is what the old queue did, and the person who
        had to fix it learned nothing.
      */}
      {open && canAct && approval.state === "awaiting" && (
        <div className="border-t border-border/60 px-4 py-3">
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            What is wrong with it? The reason goes to the stage that caused it, so it is waiting there
            when someone reopens it.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {state.taxonomy.map((cat) => (
              <button
                key={cat.slug} type="button" onClick={() => void pickReason(cat.slug)} title={cat.description}
                className={cn(
                  "rounded-sm border px-2 py-1 text-[11px] hover-elevate",
                  reason === cat.slug
                    ? "border-victory-gold bg-raised text-foreground"
                    : "border-border/60 text-muted-foreground",
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {reason && (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                {state.taxonomy.find(c => c.slug === reason)?.description}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-dim">Caused by</span>
                {state.stages.map((s) => (
                  <button
                    key={s.id} type="button" onClick={() => setStageId(s.id)}
                    className={cn(
                      "rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] hover-elevate",
                      stageId === s.id ? "border-grit-teal text-cyber-teal" : "border-border/60 text-muted-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
                {state.stages.length === 0 && (
                  <span className="text-[11px] text-dim">No stage has run yet, so there is nothing to point at.</span>
                )}
              </div>
              {/* Why that stage is pre-selected, or why nothing is. */}
              {why && <p className="mt-1 text-[10.5px] leading-relaxed text-dim">{why}</p>}

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder={reason === "other" ? "Say what is wrong. This one needs it." : "Anything else worth saying (optional)"}
                aria-label="Note to whoever picks this up"
                className="mt-2 w-full rounded-sm border border-border/60 bg-transparent px-2 py-1.5 text-[12px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal"
              />

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button" onClick={() => void decide("needs_work")} disabled={busy}
                  className="rounded-sm bg-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
                >
                  Send it back
                </button>
                <button
                  type="button" onClick={() => { setOpen(false); setReason(null); setNote(""); }}
                  className="rounded-sm border border-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default ReviewBar;
