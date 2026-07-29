import { apiFetch } from "@/lib/utils";
import { useEffect, useState } from "react";

/**
 * The Material rail.
 *
 * Spec: `20_SPEC_00_PRINCIPLES.md` §1.17, and `22_IMPLEMENTATION_PLAN.md`
 * Phase 4 item 7 ("the Material rail and the 'Why this' strip on every stage").
 *
 * §1.17 is the whole reason this exists: nothing is hidden from the user that was
 * sent to the model. The rail's job is to say what this stage actually reached
 * for, which means it has to be capable of saying "nothing". A rail that only
 * ever lists material implies material was always used, and that would make it a
 * decoration rather than a disclosure.
 *
 * So the rail reports absence as loudly as presence. Stage 03 currently sends the
 * brand's prose steering but NO reference imagery, and the rail says exactly
 * that, because a user who believes their asset library is feeding generation
 * when it is not will blame the model for a miss that is ours.
 */

export interface RailStage {
  id: string;
  stageNumber: number;
  stageKind: "brief" | "direction" | "asset" | "copy" | "crops";
  consumedFrom: string[];
}

export interface RailTake {
  slotKey: string;
  payload: unknown;
  isCurrent: boolean;
}

interface MaterialRailProps {
  stages: RailStage[];
  activeStage: RailStage | null;
  takesByStage: Record<string, RailTake[]>;
}

const STAGE_LABELS: Record<RailStage["stageKind"], string> = {
  brief: "Brief",
  direction: "Direction",
  asset: "Image",
  copy: "Copy",
  crops: "Channel crops",
};

const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="border-b border-border/40 py-1.5 last:border-b-0">
    <p className="font-mono text-[7.5px] uppercase tracking-[0.09em] text-dim">{label}</p>
    <div className="mt-0.5 text-[10.5px] leading-snug text-muted-foreground">{children}</div>
  </div>
);

export function MaterialRail({ stages, activeStage, takesByStage }: MaterialRailProps) {
  const [assetCount, setAssetCount] = useState<number | null>(null);

  // How much material exists at all, so the rail can contrast what is available
  // with what was actually used. That gap is the point.
  //
  // Counted across the whole library, not per brand, because the library is not
  // brand-scoped: GET /assets has no brandId filter, so passing one would be
  // silently ignored and the rail would state a number that looks per-brand and
  // is not. Better to report the true figure and label it accurately.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(`/api/assets?limit=1`);
        if (!res.ok) return;
        const body = (await res.json()) as { total?: number };
        if (!cancelled && typeof body.total === "number") setAssetCount(body.total);
      } catch {
        // The rail is a disclosure, not a dependency. A failed count just means
        // it says less, never that the stage stops working.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!activeStage) {
    return (
      <div className="px-3 py-2.5">
        <p className="font-display text-[13px] uppercase tracking-[0.09em] text-foreground">Material</p>
        <p className="mt-0.5 text-[10px] leading-snug text-dim">No stage open.</p>
      </div>
    );
  }

  const consumed = activeStage.consumedFrom
    .map((id) => stages.find((s) => s.id === id))
    .filter((s): s is RailStage => !!s);

  const takes = takesByStage[activeStage.id] ?? [];

  /** The director chosen at stage 02, if there is one. */
  const director = (() => {
    const dir = stages.find((s) => s.stageKind === "direction");
    if (!dir) return null;
    const t = (takesByStage[dir.id] ?? []).find((x) => x.slotKey === "direction" && x.isCurrent);
    const p = t?.payload as { name?: unknown } | undefined;
    return typeof p?.name === "string" ? p.name : null;
  })();

  const renderedTakes = takes.filter((t) => {
    const p = t.payload as { imageUrl?: unknown } | undefined;
    return typeof p?.imageUrl === "string";
  }).length;

  return (
    <div className="px-3 py-2.5">
      <p className="font-display text-[13px] uppercase tracking-[0.09em] text-foreground">Material</p>
      <p className="mt-0.5 text-[10px] leading-snug text-dim">
        What {STAGE_LABELS[activeStage.stageKind]} reached for.
      </p>

      <div className="mt-2">
        <Line label="Consumed">
          {consumed.length === 0 ? (
            <span className="text-dim">Nothing, so nothing upstream can invalidate it</span>
          ) : (
            consumed.map((s) => STAGE_LABELS[s.stageKind]).join(", ")
          )}
        </Line>

        {activeStage.stageKind !== "brief" && (
          <Line label="Director">
            {director ?? <span className="text-dim">None chosen yet</span>}
          </Line>
        )}

        {activeStage.stageKind === "asset" && (
          <>
            <Line label="Reference imagery">
              {/*
                The honest answer, and it is currently "none". Explore sends the
                brand's prose steering through the prompt but passes no reference
                images at all. Saying "0 of N" rather than staying quiet is what
                stops someone blaming the model for a miss that is ours.
              */}
              <span className="text-rebel-pink">
                None sent
                {assetCount !== null && assetCount > 0 ? ` · ${assetCount} in the library` : ""}
              </span>
            </Line>
            <Line label="Steering that did reach the model">
              Brand rules, palette and negative prompt, plus the goal and any style profile, all as
              prose in the prompt
            </Line>
            <Line label="Takes rendered">
              {renderedTakes === 0 ? <span className="text-dim">None yet</span> : renderedTakes}
            </Line>
          </>
        )}
      </div>
    </div>
  );
}
