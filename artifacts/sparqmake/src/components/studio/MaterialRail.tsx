import { apiFetch } from "@/lib/utils";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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
  /*
   * Collapsed by default (doc 41 item 14, pick A) — the closed header carries a
   * one-line summary. A warning is NEVER collapsed away: a disclosure panel
   * whose warnings hide behind a toggle is the lie §1.17 exists to prevent,
   * so any pink/gold line forces the section open.
   */
  const [open, setOpen] = useState(false);

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

  /*
   * Only CURRENT takes, and that distinction is not pedantry: reading any rendered
   * take meant the rail reported "3 sent" from a previous run while the newest run
   * had actually sent zero. A disclosure panel showing a stale number is worse than
   * showing none, because it is believed.
   */
  const rendered = takes.filter((t) => {
    const p = t.payload as { imageUrl?: unknown } | undefined;
    return t.isCurrent && typeof p?.imageUrl === "string";
  });
  const renderedTakes = rendered.length;

  /**
   * The whole material record off the newest current take that has one.
   *
   * One read rather than one loop per field, because three separate scans could
   * each land on a DIFFERENT take and the rail would then describe a run that
   * never happened.
   *
   * Null means nothing has been generated yet, which is different from zero:
   * zero is a run that used no imagery, null is a stage that has not run.
   */
  const material = (() => {
    for (const t of rendered) {
      const p = t.payload as {
        material?: {
          referenceCount?: unknown;
          subjectCount?: unknown;
          directorSelections?: unknown;
          catalogSize?: unknown;
          directorFallback?: unknown;
          directed?: unknown;
        };
      } | undefined;
      if (p?.material && typeof p.material.referenceCount === "number") return p.material;
    }
    return null;
  })();

  const sentReferences = typeof material?.referenceCount === "number" ? material.referenceCount : null;
  const catalogSize = typeof material?.catalogSize === "number" ? material.catalogSize : null;
  /*
   * `material.subjectCount` is deliberately NOT read here.
   *
   * It counts imagen REFERENCE LANES, and imagen has only two of them, so a
   * brand mark rides the subject lane and the number reads one higher than the
   * count of actual subjects. The first live spread showed exactly that:
   * subjectCount 2 for a director that chose one character and one logo.
   * Rendering it as "2 as subject" would be a true number under a false label,
   * which is the failure mode this panel exists to avoid, so the rail reports
   * the DIRECTOR'S roles below instead.
   */

  /**
   * What the Creative Director chose, which replaced what the brief token
   * scanner matched.
   *
   * The rail used to report "Matched the brief" off a `matchedCount`, and that
   * number is gone along with the scanner that produced it. Keeping the line and
   * letting it silently never render would have quietly shrunk the disclosure on
   * the one panel that exists to be able to say what really happened, so it is
   * replaced rather than dropped.
   */
  const chosen = Array.isArray(material?.directorSelections)
    ? (material.directorSelections as Array<{ role?: unknown }>)
    : null;
  const chosenSubjects = chosen?.filter((s) => s.role === "subject").length ?? null;
  const directorFallback = material?.directorFallback === true;
  /*
   * A pinned subject (an `@` mention, or the pin inherited from the previous
   * run) means the director was TOLD who is in the picture and correctly chose
   * no second subject. Painting "0 as subject" pink on those sessions accused
   * exactly the posts doing fidelity right — the same false positive the Smart
   * Bar fixed at 17ae352, still alive here until now (doc 40 P2.10).
   */
  const m = material as (typeof material & {
    subjectPin?: { assetId?: string } | null;
    subjectPinnedFrom?: string | null;
    droppedMentions?: Array<{ name?: string; reason?: string }>;
  }) | null;
  const subjectPinned = Boolean(m?.subjectPin && typeof m.subjectPin === "object");
  const droppedMentions = Array.isArray(m?.droppedMentions) ? m.droppedMentions : [];

  /*
   * A pink or gold line anywhere below means the section may not fold: what a
   * warning discloses must stay on screen without a click.
   */
  const hasWarning =
    activeStage.stageKind === "asset" &&
    (sentReferences === 0 ||
      (chosen !== null && chosen.length === 0) ||
      (chosen !== null && chosen.length > 0 && chosenSubjects === 0 && !subjectPinned) ||
      droppedMentions.length > 0 ||
      directorFallback);
  const expanded = open || hasWarning;

  /** The closed header's one-line summary of what was used. */
  const headline =
    activeStage.stageKind === "asset"
      ? chosen !== null
        ? `${chosen.length} asset${chosen.length === 1 ? "" : "s"}${
            subjectPinned && chosenSubjects === 0
              ? " · subject pinned"
              : chosenSubjects !== null
                ? ` · ${chosenSubjects} as subject`
                : ""
          }`
        : sentReferences !== null
          ? `${sentReferences} sent`
          : "nothing generated yet"
      : consumed.length > 0
        ? `from ${consumed.map((s) => STAGE_LABELS[s.stageKind]).join(", ")}`
        : "nothing consumed";

  return (
    <div className="border-b border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left hover:bg-muted/20"
        data-testid="button-toggle-material"
      >
        {expanded ? (
          <ChevronDown size={9} className="shrink-0 text-dim" />
        ) : (
          <ChevronRight size={9} className="shrink-0 text-dim" />
        )}
        <span className="font-display text-[13px] uppercase tracking-[0.09em] text-foreground">Material</span>
        <span className="ml-auto min-w-0 truncate text-[9.5px] text-dim">{headline}</span>
      </button>

      {expanded && (
      <div className="px-3 pb-2.5">
      <p className="text-[10px] leading-snug text-dim">
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
                Read off a real take, never assumed. Zero sent is stated in the
                warning hue, because a user who thinks their library fed a
                generation that it did not will blame the model for a miss that is
                ours (§1.14).
              */}
              {sentReferences === null ? (
                <span className="text-dim">
                  Nothing generated yet
                  {assetCount !== null && assetCount > 0 ? ` · ${assetCount} in the library` : ""}
                </span>
              ) : sentReferences === 0 ? (
                <span className="text-rebel-pink">
                  None sent
                  {assetCount !== null && assetCount > 0 ? ` · ${assetCount} in the library` : ""}
                </span>
              ) : (
                <>
                  {sentReferences} sent
                  {assetCount !== null && assetCount > 0 ? ` · of ${assetCount} in the library` : ""}
                </>
              )}
            </Line>
            {chosen !== null && (
              <Line label="Director chose">
                {chosen.length === 0 ? (
                  <span className="text-rebel-pink">
                    Nothing from the library
                    {catalogSize !== null ? `, out of ${catalogSize} assets it could see` : ""}
                  </span>
                ) : (
                  <>
                    {chosen.length} asset{chosen.length === 1 ? "" : "s"}
                    {chosenSubjects !== null && (
                      <>
                        {" · "}
                        {subjectPinned && chosenSubjects === 0 ? (
                          <span>subject pinned{m?.subjectPinnedFrom === "mention" ? " by your @" : ""}</span>
                        ) : (
                          <span className={chosenSubjects === 0 && !subjectPinned ? "text-rebel-pink" : undefined}>
                            {chosenSubjects} as subject
                          </span>
                        )}
                      </>
                    )}
                    {catalogSize !== null ? ` · saw ${catalogSize}` : ""}
                  </>
                )}
              </Line>
            )}
            {droppedMentions.length > 0 && (
              <Line label="Not used">
                <span className="text-victory-gold">
                  {droppedMentions
                    .map((d) => `${d.name ?? "an attachment"} — ${(d.reason ?? "not eligible").toLowerCase()}`)
                    .join("; ")}
                </span>
              </Line>
            )}
            {/*
              The one degraded path a finished spread can be in. It looks exactly
              like a normal spread, so the only way a user can tell is if we say
              so (§1.14: say what it affects). A director OUTAGE never reaches
              here, because the run aborts before spending rather than shipping
              eight undirected images.
            */}
            {directorFallback && (
              <Line label="Direction">
                <span className="text-victory-gold">
                  The director wrote prose but chose no assets, so no library imagery was selected for
                  these takes
                </span>
              </Line>
            )}
            <Line label="Prose steering">
              Brand rules, palette and negative prompt, plus the goal, the director's fingerprint and
              any style profile
            </Line>
            <Line label="Takes rendered">
              {renderedTakes === 0 ? <span className="text-dim">None yet</span> : renderedTakes}
            </Line>
          </>
        )}
      </div>
      </div>
      )}
    </div>
  );
}
