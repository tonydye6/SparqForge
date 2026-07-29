import { useCallback, useEffect, useState } from "react";

import { apiFetch, cn } from "@/lib/utils";

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
  locked: boolean;
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
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function ImageStage({ creativeId, locked }: ImageStageProps) {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/explore-plan`);
      if (!res.ok) throw new Error(String(res.status));
      setPlan((await res.json()) as PlanResponse);
    } catch {
      setError("The spread could not be planned.");
    } finally {
      setLoading(false);
    }
  }, [creativeId]);

  useEffect(() => {
    void load();
  }, [load]);

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
      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
          Stage 03 · Image · Explore
        </p>
        <h2 className="font-display text-xl tracking-wide text-foreground">
          Eight takes, on two axes you can name
        </h2>
        <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-foreground">
          Nothing has been generated yet. This is what would be made. Every take sits at a stated
          position on <span className="text-foreground">{plan.axes.a.name}</span> and{" "}
          <span className="text-foreground">{plan.axes.b.name}</span>, so picking one tells you which
          direction to push rather than only which picture you liked.
        </p>
      </div>

      {/* Axis A header. The grid is only legible if the axis is labelled above it. */}
      <div className="space-y-1.5">
        <div className="flex items-baseline gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-dim">
            Across · {plan.axes.a.name}
          </p>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="grid gap-2" style={{ gridTemplateColumns: `88px repeat(${cols}, minmax(0, 1fr))` }}>
          {/* Corner spacer, then the column labels. */}
          <div />
          {plan.axes.a.positions.map((p, i) => (
            <p
              key={p.key}
              className={cn(
                "px-0.5 font-mono text-[9px] uppercase tracking-[0.06em]",
                p.departure ? "text-foreground" : "text-dim",
                i === firstDeparture && i > 0 && "border-l border-border pl-2.5",
              )}
            >
              {p.label}
            </p>
          ))}

          {plan.axes.b.positions.map((rowPos, rowIndex) => (
            <FragmentRow
              key={rowPos.key}
              rowLabel={rowPos.label}
              rowDeparture={rowPos.departure}
              takes={plan.takes.filter((t) => t.row === rowIndex)}
              firstDeparture={firstDeparture}
              hovered={hovered}
              setHovered={setHovered}
            />
          ))}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="h-px w-[88px] bg-border" />
          <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-dim">
            Down · {plan.axes.b.name}
          </p>
        </div>
      </div>

      {/* Why a take is flagged, shown for the hovered cell rather than crammed in it. */}
      {hovered && (
        <p className="rounded-sm border border-border/60 bg-card px-3.5 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {(() => {
            const t = plan.takes.find((x) => x.id === hovered);
            if (!t) return null;
            return (
              <>
                <span className="text-foreground">
                  {t.axisA.label} · {t.axisB.label}
                </span>{" "}
                {t.directive}.
                {t.offBrief && (
                  <span className="text-foreground"> {t.offBrief.reason}</span>
                )}
              </>
            );
          })()}
        </p>
      )}

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
        <div className="ml-auto">
          <button
            disabled
            title="Generation arrives in the next increment"
            className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-primary-foreground disabled:opacity-40"
          >
            {locked ? "Locked" : `Run these ${plan.takes.length}`}
          </button>
        </div>
      </div>

      {/* Never overstate what is built. */}
      <p className="text-[11px] leading-relaxed text-dim">
        Generation is not wired up yet, so the button above does nothing. The spread, the axes, the
        off-brief flagging and the price are real and come from the server.
      </p>
    </div>
  );
}

/** One grid row: the axis-B label, then that row's takes. */
function FragmentRow({
  rowLabel,
  rowDeparture,
  takes,
  firstDeparture,
  hovered,
  setHovered,
}: {
  rowLabel: string;
  rowDeparture: boolean;
  takes: ExploreTake[];
  firstDeparture: number;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}) {
  return (
    <>
      <p
        className={cn(
          "self-center pr-1 font-mono text-[9px] uppercase tracking-[0.06em]",
          rowDeparture ? "text-foreground" : "text-dim",
        )}
      >
        {rowLabel}
      </p>
      {takes.map((t) => (
        <button
          key={t.id}
          onMouseEnter={() => setHovered(t.id)}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered(t.id)}
          onBlur={() => setHovered(null)}
          aria-label={`${t.axisA.label}, ${t.axisB.label}${t.offBrief ? ", off brief" : ""}`}
          className={cn(
            // Planned state per §1.8: dashed, no image, because nothing exists yet.
            // min-w-0 lets the cell shrink inside the grid track instead of
            // pushing its own contents over the neighbouring column.
            "flex aspect-[4/3] min-w-0 flex-col justify-between overflow-hidden rounded-sm border border-dashed p-2 text-left transition-colors",
            // Departures sit on the raised ground. Material rather than colour,
            // per §1.8, because off-brief is a property of the plan and not one
            // of the seven states, so it has no hue of its own to spend.
            t.offBrief ? "bg-raised" : "bg-transparent",
            hovered === t.id ? "border-grit-teal bg-grit-teal/5" : "border-border",
          )}
          // A wider gutter at the crossing point. A gap is content-independent,
          // so unlike the ground lift or the border style it still separates the
          // two halves once these tiles contain generated images.
          style={t.col === firstDeparture && t.col > 0 ? { marginLeft: 10 } : undefined}
        >
          {/*
            No axis label in here. It would repeat the column header above and the
            row label beside, in every single cell, and at this column width the
            repeat is what pushed the off-brief badge over the next tile. The
            headers carry the position; the cell carries only what is true of this
            cell alone. Screen readers still get both, from aria-label.
          */}
          <div className="flex min-w-0 justify-end">
            {t.offBrief && (
              <span
                className="flex min-w-0 items-center gap-0.5 rounded-sm border border-muted-foreground/50 bg-surround px-1 py-px font-mono text-[7px] uppercase tracking-[0.06em] text-muted-foreground"
                title={t.offBrief.reason}
              >
                {/*
                  No warning icon. A departure is a deliberate, valid choice and
                  often the best take on the board; a caution triangle would tell
                  the user it is a problem, which is the opposite of §1.17's point
                  in flagging it at all.
                */}
                <span className="truncate">Off brief</span>
              </span>
            )}
          </div>
          <span className="truncate font-mono text-[8px] uppercase tracking-[0.06em] text-dim">
            Not made yet
          </span>
        </button>
      ))}
    </>
  );
}
