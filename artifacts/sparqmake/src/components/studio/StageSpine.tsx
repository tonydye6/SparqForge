import { useCallback, useRef } from "react";
import { ArrowRight, Lock, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The spine: five stages across the top of the Studio.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.1 to §1.5, §4.3
 * and the Studio artifact, screens 01 to 04.
 *
 * What this replaces is back and forward. Those are a stack: they know only the
 * step before this one, they forget the branch you abandoned, and they cannot
 * tell you what going back will cost. The spine is ADDRESSABLE history, so you
 * jump straight to the decision you want to revisit and can see its
 * consequences before committing to them.
 *
 * Two things this component deliberately does NOT do:
 *
 *   It does not compute arrow direction. That comes from the server, which gets
 *   it from the dependency engine, so there is one source of truth for what the
 *   graph says. A copy-led post renders a reversed arrow because the graph
 *   really is reversed, not because a component guessed from position.
 *
 *   It does not decide what is stale. Staleness is a property of the data.
 */

export type SpineStatus = "empty" | "active" | "done" | "stale" | "locked";
export type EdgeDirection = "forward" | "inverted" | "both" | "none";

export interface SpineStage {
  id: string;
  stageNumber: number;
  label: string;
  /** One line of what this stage decided, or what it is waiting for. */
  summary: string;
  /**
   * The stage's decision as pictures, when it has one (the pick, the clip).
   * Rendered INSTEAD of the summary — the grid is pictures (doc 38 §3), and
   * "13 takes" says effort was spent without saying what was decided
   * (doc 41 item 16, Tony's pick A).
   */
  thumbs?: Array<{ url: string; video?: boolean }>;
  status: SpineStatus;
}

export interface SpineEdge {
  from: string;
  to: string;
  direction: EdgeDirection;
}

export interface StageSpineProps {
  stages: SpineStage[];
  edges: SpineEdge[];
  activeStageId?: string;
  onOpenStage: (stageId: string) => void;
  className?: string;
}

/**
 * No boxes. A stage is a strip of its own pictures with a label above it —
 * the grid is pictures (doc 38 §3), and the state lives in an underline edge
 * and the label's colour rather than five outlined containers competing for
 * the same weight. `edge` is the 2px baseline bar; `key` colours the label.
 */
const STATUS_STYLES: Record<SpineStatus, { edge: string; key: string }> = {
  // Nothing here yet. Quiet, but still a real target you can click into.
  empty: { edge: "bg-transparent", key: "text-dim" },
  active: { edge: "bg-grit-teal", key: "text-foreground" },
  done: { edge: "bg-transparent", key: "text-muted-foreground" },
  // Pink: built on something you have since reopened. This means "needs a
  // decision", not "wrong", and the copy elsewhere says so.
  stale: { edge: "bg-rebel-pink", key: "text-rebel-pink" },
  locked: { edge: "bg-grit-teal/50", key: "text-muted-foreground" },
};

function Connector({ direction }: { direction: EdgeDirection }) {
  if (direction === "both") {
    // A stage consuming the stage that consumes it. Should be impossible, so
    // say so plainly rather than rendering a confident arrow over a broken
    // graph. The engine reports this specifically so it can surface here.
    return (
      <span className="flex w-5 shrink-0 items-center justify-center text-rebel-pink" title="Circular dependency">
        <AlertTriangle size={13} aria-label="Circular dependency" />
      </span>
    );
  }
  if (direction === "none") {
    return <span className="w-5 shrink-0" aria-hidden="true" />;
  }
  const inverted = direction === "inverted";
  return (
    <span
      className={cn(
        "flex w-6 shrink-0 items-center justify-center pb-2",
        inverted ? "text-cyber-teal" : "text-dim/50",
      )}
      title={inverted ? "This stage was built to fit the one after it" : undefined}
    >
      <ArrowRight size={13} className={cn(inverted && "-scale-x-100")} aria-hidden="true" />
    </span>
  );
}

export function StageSpine({
  stages,
  edges,
  activeStageId,
  onOpenStage,
  className,
}: StageSpineProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Arrow keys move along the row, Enter opens. Per §4.3 the spine must be
   * navigable without a mouse, and roving focus is what makes a toolbar of five
   * buttons behave the way a keyboard user expects.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let next: number | null = null;
      if (e.key === "ArrowRight") next = Math.min(index + 1, stages.length - 1);
      if (e.key === "ArrowLeft") next = Math.max(index - 1, 0);
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = stages.length - 1;
      if (next === null) return;
      e.preventDefault();
      refs.current[next]?.focus();
    },
    [stages.length],
  );

  const edgeBetween = (fromId: string, toId: string): EdgeDirection =>
    edges.find((x) => x.from === fromId && x.to === toId)?.direction ?? "none";

  return (
    <div
      className={cn("flex items-stretch gap-0 border-b border-border-soft px-5 pt-3 pb-0", className)}
      role="toolbar"
      aria-label="Post stages"
                 aria-orientation="horizontal"
    >
      {stages.map((stage, i) => {
        const style = STATUS_STYLES[stage.status];
        const isActive = stage.id === activeStageId;
        return (
          <div key={stage.id} className="flex min-w-0 flex-1 items-stretch">
            <button
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              onClick={() => onOpenStage(stage.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              // Roving tabindex: one stop for the whole toolbar.
              tabIndex={isActive || (!activeStageId && i === 0) ? 0 : -1}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "group/stage min-w-0 flex-1 rounded-t-md px-2 pb-0 pt-1 text-left transition-colors",
                "hover:bg-white/[0.03]",
                !isActive && stage.status !== "stale" && "opacity-80 hover:opacity-100",
              )}
            >
              <span className={cn("flex items-center gap-1.5 ui-label", style.key)}>
                {stage.status === "locked" && <Lock size={10} aria-hidden="true" />}
                <span className="ui-data font-normal">{String(stage.stageNumber).padStart(2, "0")}</span>
                {stage.label}
                {/* Never colour alone: the state is also said in words. */}
                {stage.status === "stale" && <span className="ml-auto normal-case tracking-normal">Stale</span>}
                {stage.status === "locked" && <span className="ml-auto normal-case tracking-normal">Locked</span>}
              </span>
              {stage.thumbs && stage.thumbs.length > 0 ? (
                <span className="mt-1.5 flex items-center gap-1.5">
                  {stage.thumbs.map((t, j) => (
                    <span
                      key={j}
                      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md"
                    >
                      <img src={t.url} alt="" className="h-full w-full object-cover" />
                      {t.video && (
                        <span
                          aria-label="clip"
                          className="absolute inset-0 flex items-center justify-center text-[11px] text-white"
                          style={{ textShadow: "0 0 4px #000" }}
                        >
                          {"▸"}
                        </span>
                      )}
                    </span>
                  ))}
                </span>
              ) : (
                <span
                  className={cn(
                    "mt-1 block truncate text-[12.5px] leading-snug",
                    stage.status === "empty" ? "text-dim" : "text-foreground",
                  )}
                >
                  {stage.summary}
                </span>
              )}
              {/* The state edge: a 2px baseline, not a ring around a box. */}
              <span aria-hidden="true" className={cn("mt-2 block h-0.5 rounded-full", style.edge)} />
            </button>
            {i < stages.length - 1 && (
              <Connector direction={edgeBetween(stage.id, stages[i + 1].id)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface ReopenBarProps {
  /** Plain-language summary from the engine, not assembled here. */
  summary: string;
  staleCount: number;
  /** Price of re-running, in cents. Omitted when unknown. */
  rerunCents?: number;
  onRerun: () => void;
  onKeep: () => void;
}

/**
 * The bar offered after reopening a stage.
 *
 * The load-bearing detail is that "Keep them as they are" sits beside the
 * re-run with equal weight, per §1.5. Automatic regeneration is never correct:
 * the user reopened one decision, which is not consent to redo the four things
 * built on top of it. The price is shown because a re-run costs money and
 * hiding that makes the choice dishonest.
 */
export function ReopenBar({ summary, staleCount, rerunCents, onRerun, onKeep }: ReopenBarProps) {
  if (staleCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-rebel-pink/30 bg-rebel-pink/10 px-4 py-2">
      <p className="text-[12px] leading-snug text-foreground">{summary}</p>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onKeep}
          className="rounded-md px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground hover-elevate"
        >
          Keep them as they are
        </button>
        <button
          type="button"
          onClick={onRerun}
          className="rounded-md bg-rebel-pink px-3 py-1.5 text-[12.5px] font-semibold text-[#170309] hover-elevate"
        >
          Re-run {staleCount}
          {typeof rerunCents === "number" && (
            <span data-numeric> · ${(rerunCents / 100).toFixed(2)}</span>
          )}
        </button>
      </div>
    </div>
  );
}
