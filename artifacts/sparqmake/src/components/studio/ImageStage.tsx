import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch, cn } from "@/lib/utils";
import { InfoDot } from "@/components/studio/InfoDot";
import { RefineDeck, type StageTake } from "@/components/studio/RefineDeck";
import { MotionPanel } from "@/components/studio/MotionPanel";

/**
 * Stage 03 · Image · Explore.
 *
 * Spec: `22_IMPLEMENTATION_PLAN.md` Phase 4 item 3, and
 * `20_SPEC_00_PRINCIPLES.md` §1.5, §1.8, §1.12 and §1.17.
 *
 * This is the plan, not the result. Nothing has been generated when this screen
 * opens and nothing will be until someone presses the button, because eight
 * images is real money and §1.5 says a run is offered with its price rather than
 * taken automatically.
 *
 * The grid is the argument. Eight thumbnails with no stated structure is a
 * lottery, and picking from a lottery teaches you nothing about what to ask for
 * next. Here every take sits at a named position on two named axes, so choosing
 * one is a judgement about a direction rather than a reaction to a picture.
 *
 * Off-brief takes are flagged and kept (§1.17). The take that goes past what you
 * asked for is often the useful one, so hiding it would be wrong, and showing it
 * unmarked would misrepresent what you asked for. It is labelled, with the
 * reason, and it stays on the board.
 *
 * Empty cells are drawn as planned-state placeholders per §1.8: dashed outline,
 * no image, because nothing has been made yet and a solid tile would imply
 * otherwise.
 */

interface ImageStageProps {
  creativeId: string;
  stageId: string;
  /** §1.2: one stage, two modes. Explore and Refine are not separate stages. */
  mode: "explore" | "refine";
  /**
   * Which Explore slot Refine is working on, from the stage row. This used to
   * be inferred from the current "selected" take — which is why entering
   * Refine had to WRITE one, un-picking the chosen image (doc 40 P0.1).
   */
  modeSlotKey: string | null;
  /** For Refine's `@` picker; mentions are brand-scoped. */
  brandId: string | null;
  /** Every take on this stage, so the deck can show a slot's history. */
  takes: StageTake[];
  locked: boolean;
  onChanged: () => void;
  /** The shell's forward to the next stage, surfaced inside Motion (doc 41 item 7). */
  onContinue?: () => void;
}

interface TakeOutcome {
  takeId: string;
  ok: boolean;
  imageUrl?: string;
  error?: string;
}

interface RunResponse {
  outcomes: TakeOutcome[];
  succeeded: number;
  failed: number;
  costUsd: number;
}

interface OffBrief {
  axes: string[];
  reason: string;
}

interface ExploreTake {
  id: string;
  col: number;
  row: number;
  axisA: { name: string; label: string };
  axisB: { name: string; label: string };
  directive: string;
  offBrief: OffBrief | null;
}

interface AxisPosition {
  key: string;
  label: string;
  directive: string;
  departure: boolean;
}

interface PlanResponse {
  axes: { a: { name: string; positions: AxisPosition[] }; b: { name: string; positions: AxisPosition[] } };
  takes: ExploreTake[];
  costCents: number;
  offBriefCount: number;
  fallback: boolean;
  goal: { id: string; label: string; fromBrief: boolean };
  generated: boolean;
  /** Phase 7 item 5. Absent on an API that predates it, hence optional. */
  budget?: {
    monthSpentUsd: number;
    monthBudgetUsd: number | null;
    wouldReachUsd: number;
    wouldExceed: boolean;
    hard: boolean;
  };
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Phase 9 item 9 · which medium this stage is showing.
 *
 * A toggle rather than a sixth stage: the spine's five stages are fixed display
 * order, and a separate video stage would make one post read as two pipelines.
 * Local state, not persisted, because it is a view of the stage rather than a
 * property of it: the still and the motion both continue to exist whichever tab
 * is open, which is the whole point of the lineage column.
 */
function MediumSwitch({
  medium,
  onChange,
}: {
  medium: "image" | "motion";
  onChange: (m: "image" | "motion") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-sm border border-border" role="group" aria-label="Medium">
      {(["image", "motion"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={medium === m}
          onClick={() => onChange(m)}
          className={cn(
            "px-3 py-1 font-mono text-[9px] uppercase tracking-[0.09em] transition-colors",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cyber-teal",
            medium === m
              ? "bg-primary text-primary-foreground"
              : "text-dim hover:text-muted-foreground",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function ImageStage({ creativeId, stageId, mode, modeSlotKey, brandId, takes, locked, onChanged, onContinue }: ImageStageProps) {
  const [medium, setMedium] = useState<"image" | "motion">("image");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [run, setRun] = useState<RunResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  /*
   * The spread size for THIS run (doc 41 item 12). Null means the app default;
   * choosing re-plans (a free GET) so the quoted price always describes what
   * the button will actually charge.
   */
  const [spreadSize, setSpreadSize] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/creatives/${creativeId}/explore-plan${spreadSize ? `?size=${spreadSize}` : ""}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      setPlan((await res.json()) as PlanResponse);
    } catch {
      setError("The spread could not be planned.");
    } finally {
      setLoading(false);
    }
  }, [creativeId, spreadSize]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The PICKED slot — the current "selected" take, which since 0042 always
   * carries the image it points at. Used to mark the tile that is in use.
   * The refine target is `modeSlotKey` from the stage row, a separate fact:
   * looking closer at a take must never change which one the post uses.
   */
  const selectedSlotKey = (() => {
    const sel = takes.find((t) => t.slotKey === "selected" && t.isCurrent);
    const p = sel?.payload as { slotKey?: unknown } | undefined;
    return typeof p?.slotKey === "string" ? p.slotKey : null;
  })();

  async function enterRefine(slotKey: string) {
    if (locked || switching) return;
    setSwitching(true);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/image-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "refine", slotKey }),
      });
      if (res.ok) onChanged();
    } finally {
      setSwitching(false);
    }
  }

  /**
   * Spend the money. The button is the consent (§1.5), so this is the only place
   * a spread is ever generated: nothing here runs on mount or on navigation.
   */
  async function runSpread() {
    if (!plan || locked || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/explore-run`, {
        method: "POST",
        // The size the banner quoted rides along, so plan and charge agree.
        ...(spreadSize
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spreadSize }) }
          : {}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // The server's copy already says what it affects and whether anything was
        // charged, so show it rather than inventing a generic failure line.
        setRunError((body as { error?: string; message?: string })?.error ?? (body as { message?: string })?.message ?? "The spread could not be run.");
        return;
      }
      setRun(body as RunResponse);
    } catch {
      setRunError("The spread could not be reached. Nothing was charged.");
    } finally {
      setRunning(false);
    }
  }

  /*
   * The spread as it was SAVED, not just as it was returned.
   *
   * `run` is the response of a run performed in this browser session, and it was
   * the only source a tile consulted. So a spread that cost real money rendered
   * as eight "Not made yet" tiles the moment the page was reloaded or reopened
   * from the spine, while eight current takes with image URLs sat in the
   * database. Paying for work and then being told it does not exist is the
   * worst version of this product's central failure mode: the screen has to be
   * able to say what actually happened (§1.17).
   *
   * Keyed by slotKey, which is the take id, and restricted to isCurrent so a
   * re-run of one take shows the new image rather than an older sibling.
   */
  const persisted = useMemo(() => {
    const bySlot = new Map<string, TakeOutcome>();
    for (const t of takes) {
      if (!t.isCurrent) continue;
      const p = t.payload as { imageUrl?: unknown } | undefined;
      if (typeof p?.imageUrl !== "string") continue;
      bySlot.set(t.slotKey, { takeId: t.slotKey, ok: true, imageUrl: p.imageUrl });
    }
    return bySlot;
  }, [takes]);

  /*
   * The in-session run wins where it has an opinion, because after re-running a
   * single take it holds the newest image for that slot while `takes` may not
   * have been refetched yet. Everything else falls back to what was saved, which
   * is what makes a partial re-run show one fresh take beside seven stored ones
   * instead of blanking the other seven.
   */
  /** The take stage 03 has handed to Copy, if any. */
  const usedSlotKey = (() => {
    const sel = takes.find((t) => t.slotKey === "selected" && t.isCurrent);
    const p = sel?.payload as { slotKey?: unknown } | undefined;
    return typeof p?.slotKey === "string" ? p.slotKey : null;
  })();

  const useTake = useCallback(async (slotKey: string) => {
    const res = await apiFetch(`/api/creatives/${creativeId}/use-take`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotKey }),
    });
    if (res.ok) onChanged();
  }, [creativeId, onChanged]);

  const outcomeFor = (takeId: string): TakeOutcome | null =>
    run?.outcomes.find((o) => o.takeId === takeId) ?? persisted.get(takeId) ?? null;

  /*
   * BEFORE every early return, deliberately. Refine is a MODE of stage 03, not
   * a different stage, so a switch that only appeared in Explore would make the
   * medium unreachable from half of its own stage. The same applies while the
   * spread is planning or has failed: the motion that already exists does not
   * stop existing because the image plan is loading.
   */
  if (medium === "motion") {
    const pickPayload = takes.find((t) => t.slotKey === "selected" && t.isCurrent)?.payload as
      | { imageUrl?: string }
      | undefined;
    const motionPayload = takes.find((t) => t.slotKey === "motion" && t.isCurrent)?.payload as
      | { videoUrl?: string; sourceImageUrl?: string; instruction?: string | null; durationSeconds?: number; costUsd?: number }
      | undefined;
    return (
      <div>
        <div className="mx-auto max-w-5xl px-6 pt-6">
          <MediumSwitch medium={medium} onChange={setMedium} />
        </div>
        <MotionPanel
          creativeId={creativeId}
          stageId={stageId}
          pickImageUrl={typeof pickPayload?.imageUrl === "string" ? pickPayload.imageUrl : null}
          motionTake={motionPayload?.videoUrl ? motionPayload : null}
          locked={locked}
          onChanged={onChanged}
          onContinue={onContinue}
        />
      </div>
    );
  }

  if (mode === "refine" && modeSlotKey) {
    return (
      <div className="space-y-4">
        <div className="mx-auto max-w-5xl px-6 pt-6">
          <MediumSwitch medium={medium} onChange={setMedium} />
        </div>
      <RefineDeck
        creativeId={creativeId}
        stageId={stageId}
        brandId={brandId}
        slotKey={modeSlotKey}
        takes={takes}
        locked={locked}
        onChanged={onChanged}
        // A refined take a person is happy with must be one press from being
        // THE pick — the same full-render pick the inspector's Use this runs.
        onUse={() => void useTake(modeSlotKey)}
      />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-[12.5px] text-dim">Planning the spread.</p>
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-6">
        <p className="text-[12.5px] text-rebel-pink">{error ?? "No plan."}</p>
        <button
          onClick={() => void load()}
          className="rounded-sm border border-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate"
        >
          Try again
        </button>
      </div>
    );
  }

  const cols = plan.axes.a.positions.length;
  /**
   * The column where the spread stops honouring the brief and starts departing.
   *
   * Drawn as a gutter, and the gutter is what actually reads: a hairline rule
   * against this ground is invisible, so the void between the columns is the
   * cue. Verified against a filled-tile mock, where it works BETTER than empty,
   * because busy imagery makes a void more visible rather than less.
   * The raised ground and the dashed border both stop working the moment tiles
   * contain generated images: the fill is hidden and every border becomes solid.
   * A rule between columns is independent of what is inside the tiles, so it
   * still separates the two halves when the grid is full of pictures.
   */
  const firstDeparture = plan.axes.a.positions.findIndex((p) => p.departure);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <MediumSwitch medium={medium} onChange={setMedium} />
      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
          Stage 03 · Media · Explore
        </p>
        <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-foreground">
          Eight takes on <span className="text-cyber-teal">{plan.axes.a.name}</span> ×{" "}
          <span className="text-cyber-teal">{plan.axes.b.name}</span>
          <InfoDot
            text={`Every take sits at a stated position on ${plan.axes.a.name} and ${plan.axes.b.name}, so picking one tells you which direction to push rather than only which picture you liked. Takes that go past the brief on purpose are kept and marked, not hidden.`}
          />
        </h2>
        {/*
          The paragraph that lived here had to know whether the spread existed,
          and once read "Nothing has been generated yet" over eight rendered
          takes. The grid itself already shows made vs not-made; prose
          restating the screen's own state is exactly the text noise Tony
          called out, so the axes moved into the title and the why into the dot.
        */}
      </div>

      {/*
        THE GRID IS PICTURES; THE INSPECTOR IS WORDS.

        The previous form labelled the grid three ways at once — column heads,
        row labels, an "Off brief" badge in the cell — and Tony red-penned all
        of it, twice: first the jargon keys, then the plain-language heads that
        replaced them. Any words near the thumbnails are noise. So the tiles
        carry nothing but state-as-material (§1.8): dashed = not made, image =
        made, gold edge = past the brief, pink edge = did not render, teal =
        in use. Hovering or focusing a tile points the inspector at it, and the
        inspector holds ALL the words: the position in plain language, the
        directive the director wrote for that cell, and the actions.
      */}
      <div className="flex items-start gap-4">
        <div
          className="grid flex-1 gap-2 rounded-sm bg-surround p-2"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {plan.axes.b.positions.map((rowPos, rowIndex) =>
            plan.takes
              .filter((t) => t.row === rowIndex)
              .map((t) => {
                const o = outcomeFor(t.id);
                return (
                  <button
                    key={t.id}
                    onMouseEnter={() => setHovered(t.id)}
                    onFocus={() => setHovered(t.id)}
                    aria-label={`${t.axisA.label}, ${t.axisB.label}${t.offBrief ? ", past the brief" : ""}${o?.ok ? "" : o ? ", did not render" : ", not made yet"}`}
                    className={cn(
                      "relative aspect-square min-w-0 overflow-hidden rounded-sm border transition-colors",
                      // The material vocabulary, one edge at a time.
                      o?.ok
                        ? t.offBrief
                          ? "border-victory-gold/60"
                          : "border-border"
                        : o
                          ? "border-rebel-pink/60"
                          : t.offBrief
                            ? "border-dashed border-victory-gold/40"
                            : "border-dashed border-border",
                      usedSlotKey === t.id && "border-solid border-grit-teal",
                      hovered === t.id && "border-solid border-cyber-teal",
                    )}
                    // The gutter where the spread stops honouring the brief. A
                    // gap is content-independent, so it survives the tiles
                    // filling with images where a border style would vanish.
                    style={t.col === firstDeparture && t.col > 0 ? { marginLeft: 10 } : undefined}
                  >
                    {o?.ok && o.imageUrl && (
                      <img src={o.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                  </button>
                );
              }),
          )}
        </div>

        <SpreadInspector
          take={plan.takes.find((x) => x.id === (hovered ?? usedSlotKey)) ?? plan.takes[0] ?? null}
          outcomeFor={outcomeFor}
          usedSlotKey={usedSlotKey}
          onUse={(k) => void useTake(k)}
          onRefine={enterRefine}
          canAct={!locked && !switching}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border/60 bg-card px-3.5 py-2.5">
        <div className="space-y-0.5">
          <p className="text-[11.5px] text-muted-foreground">
            <span className="font-medium text-foreground" data-numeric>
              {plan.takes.length}
            </span>{" "}
            takes,{" "}
            <span className="font-medium text-foreground" data-numeric>
              {money(plan.costCents)}
            </span>{" "}
            to run.{" "}
            {plan.offBriefCount > 0 && (
              <>
                <span className="text-foreground" data-numeric>
                  {plan.offBriefCount}
                </span>{" "}
                go past the brief on purpose, and they are kept rather than hidden.
              </>
            )}
          </p>
          <p className="text-[10.5px] leading-relaxed text-dim">
            {plan.goal.fromBrief ? (
              <>
                Axes chosen for the goal your brief set: {plan.goal.label.toLowerCase()}.
              </>
            ) : (
              <>
                No goal recorded on the brief yet, so these are the default axes rather than ones
                chosen for this post. Save stage 01 and this will re-plan.
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/*
            How many to make this run (doc 41 item 12). The choice re-plans,
            so the price to the left is always the price of what runs. Smaller
            spreads keep at least one departure by construction (SPREAD_SIZES),
            so choosing 4 never quietly deletes the off-brief takes.
          */}
          {!locked && (
            <div className="flex items-center gap-0.5 rounded-sm border border-border p-0.5" role="group" aria-label="How many takes to generate">
              {[4, 6, 8].map((n) => (
                <button
                  key={n}
                  onClick={() => setSpreadSize(n)}
                  disabled={running}
                  aria-pressed={plan.takes.length === n}
                  className={cn(
                    "rounded-sm px-2 py-1 font-mono text-[9.5px] hover-elevate disabled:opacity-40",
                    plan.takes.length === n ? "bg-grit-teal/15 text-cyber-teal" : "text-muted-foreground",
                  )}
                  data-testid={`button-spread-size-${n}`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {/*
            The picked take's path into Refine, standing beside the run button
            instead of hidden in the hover inspector — doc 40 P0.3's second
            half: the affordance existed and nothing announced it.
          */}
          {selectedSlotKey && !locked && (
            <button
              onClick={() => void enterRefine(selectedSlotKey)}
              disabled={switching}
              className="rounded-sm border border-grit-teal px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-cyber-teal hover-elevate disabled:opacity-40"
              data-testid="button-refine-pick"
            >
              Refine the pick
            </button>
          )}
          <button
            onClick={() => void runSpread()}
            disabled={locked || running}
            className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-primary-foreground hover-elevate disabled:opacity-40"
          >
            {locked
              ? "Locked"
              : running
                ? "Running"
                // A saved spread counts as a run, not just one made in this tab.
                // Offering "Run these 8" over eight visible takes invites a
                // second $0.48 for work already paid for.
                : run || persisted.size > 0
                  ? "Run again"
                  : `Run these ${plan.takes.length}`}
          </button>
        </div>
      </div>

      {/*
        Phase 7 item 5 — the soft cap, said BEFORE the turn rather than after.
        A cap you only learn about from the receipt is not a control.

        It does NOT disable the button. The monthly number is advisory by
        design; the gate that actually refuses spend is the DAILY threshold in
        `reserveBudget`, and the run returns 429 with its own message when that
        one bites. Two things that can say no is how a build ends up with a
        limit nobody can find.

        Rebel Pink is right here where it was wrong on the Cost surface: this is
        the *needs you* case — a person is about to spend, and a decision is
        being asked for.
      */}
      {plan.budget?.wouldExceed && plan.budget.monthBudgetUsd !== null && (
        <p
          role="status"
          className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-rebel-pink"
        >
          This spread would take the month to{" "}
          <span data-numeric>${plan.budget.wouldReachUsd.toFixed(2)}</span>, past the{" "}
          <span data-numeric>${plan.budget.monthBudgetUsd.toFixed(2)}</span> monthly budget.
          You can still run it — this is a warning, not a limit.
        </p>
      )}

      {runError && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-rebel-pink">
          {runError}
        </p>
      )}

      {run && (
        <p className="text-[11px] leading-relaxed text-dim">
          {run.failed === 0 ? (
            <>
              All <span data-numeric>{run.succeeded}</span> takes rendered. Charged{" "}
              <span data-numeric>{money(Math.round(run.costUsd * 100))}</span>.
            </>
          ) : (
            <>
              <span data-numeric>{run.succeeded}</span> of{" "}
              <span data-numeric>{run.succeeded + run.failed}</span> takes rendered. You were charged{" "}
              <span data-numeric>{money(Math.round(run.costUsd * 100))}</span>, for the ones that
              arrived only. Run again to retry the rest.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The inspector. All the words the grid refuses to carry.
 *
 * Follows hover and keyboard focus, and stays on the last take pointed at
 * rather than blinking away on mouseleave: an inspector that vanishes the
 * moment you travel toward its buttons is a trap, and the sticky form is also
 * what lets the actions live here instead of crowding every tile.
 */
function SpreadInspector({
  take,
  outcomeFor,
  usedSlotKey,
  onUse,
  onRefine,
  canAct,
}: {
  take: ExploreTake | null;
  outcomeFor: (takeId: string) => TakeOutcome | null;
  usedSlotKey: string | null;
  onUse: (slotKey: string) => void;
  onRefine: (slotKey: string) => void;
  canAct: boolean;
}) {
  if (!take) return null;
  const o = outcomeFor(take.id);

  return (
    <aside
      className="w-[340px] shrink-0 overflow-hidden rounded-sm border border-grit-teal/60 bg-card"
      data-testid="spread-inspector"
      aria-live="polite"
    >
      <p className="border-b border-border/60 px-3.5 py-2 font-mono text-[9px] uppercase tracking-[0.08em] text-cyber-teal">
        {take.axisA.label} × {take.axisB.label}
        {take.offBrief && <span className="text-victory-gold"> · past the brief, on purpose</span>}
      </p>

      <div className="aspect-square bg-surround">
        {o?.ok && o.imageUrl ? (
          <img src={o.imageUrl} alt={`${take.axisA.label}, ${take.axisB.label}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className={cn("font-mono text-[9px] uppercase tracking-[0.08em]", o && !o.ok ? "text-rebel-pink" : "text-dim")}>
              {o && !o.ok ? "Did not render · run again retries it" : "Not made yet"}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2 px-3.5 py-3">
        <p className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-grit-teal">What drives this take</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {take.directive}.
          {take.offBrief && <span className="text-foreground"> {take.offBrief.reason}</span>}
        </p>
        {o?.ok && (
          <div className="flex items-center gap-2 pt-1">
            <span className="flex-1" />
            <button
              onClick={() => canAct && onRefine(take.id)}
              disabled={!canAct}
              className="rounded-sm border border-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate disabled:opacity-40"
              data-testid="inspector-refine"
            >
              Refine
            </button>
            {/*
              The way forward. Until this existed there was none: stage 03
              could produce eight takes and the spine still called it empty,
              with nothing downstream told which one won.
            */}
            <button
              onClick={() => onUse(take.id)}
              className={cn(
                "rounded-sm border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] hover-elevate",
                usedSlotKey === take.id ? "border-grit-teal text-grit-teal" : "border-grit-teal text-cyber-teal",
              )}
              data-testid="inspector-use"
            >
              {usedSlotKey === take.id ? "In use" : "Use this"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
