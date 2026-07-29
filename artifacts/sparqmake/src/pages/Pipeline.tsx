import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "wouter";
import { getCalendarEntries, useGetCreatives } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { MediaTile } from "@/components/ui/media-tile";
import { StateChip } from "@/components/ui/state-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { PublishHealthBanner } from "@/components/PublishHealthBanner";
import { agingDays, stateFromPublishStatus, type CreativeState } from "@/lib/creative-state";

/**
 * Pipeline. Replaces the Calendar and Content Plan pages.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.8, and the Studio
 * artifact, screen 02.
 *
 * The design decision this page turns on: CHANNEL IS NOT A ROW AXIS. Every
 * social scheduler treats channel as a filter, and the unit of work here is
 * one creative fanning out to several channels, so a card is a creative and
 * the ×N badge says how many channels it goes to. Channel lanes would turn a
 * week of five posts into a mostly empty five-by-seven table, which is exactly
 * the "it reads like a table" problem this replaces.
 *
 * Three other rules from the spec that are easy to accidentally undo:
 *
 * 1. NO CELL IS EVER EMPTY. A quiet day carries a prompt, not blank space.
 * 2. AGING IS DRAWN. Work that has sat still is the thing no other tool in
 *    this category surfaces, and it is why things get stuck for weeks.
 * 3. UNDATED WORK STAYS VISIBLE, in a rail rather than falling off the bottom
 *    of a queue nobody scrolls.
 */

interface CalEntry {
  id: string;
  creativeId: string;
  variantId: string;
  platform: string;
  scheduledAt: string;
  publishStatus: string;
  publishError?: string | null;
  retryCount?: number;
}

/** One creative on one day, with every channel it goes to on that day. */
interface PipelineCard {
  creativeId: string;
  name: string;
  thumbnail?: string | null;
  entries: CalEntry[];
  state: CreativeState;
  earliest: Date;
  aging: number | null;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week containing `d`, at local midnight. */
function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (out.getDay() + 6) % 7; // Sunday is 0, so Monday becomes 0
  out.setDate(out.getDate() - shift);
  return out;
}

/**
 * Parse the ?week= parameter, which is the Monday of the week being viewed as
 * YYYY-MM-DD.
 *
 * Constructed from parts rather than `new Date(str)`, because the string form
 * is parsed as UTC midnight and would shift the displayed week by a day for
 * anyone west of Greenwich.
 *
 * Returns null for anything malformed, so a hand-edited or truncated URL falls
 * back to the current week instead of rendering Invalid Date.
 */
function parseWeekParam(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The ?week= value for a date: always the Monday, so URLs are canonical. */
function weekParamFor(d: Date): string {
  const w = weekStart(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.getFullYear()}-${pad(w.getMonth() + 1)}-${pad(w.getDate())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Worst state wins, because a card is a summary and the thing you need to know
 * about a group is its worst member. A failure inside an otherwise scheduled
 * fan-out must not be hidden by the four siblings that are fine.
 */
const STATE_RANK: Record<CreativeState, number> = {
  failed: 6,
  needs_attention: 5,
  drafting: 4,
  planned: 3,
  scheduled: 2,
  ready: 1,
  published: 0,
};

export default function Pipeline() {
  /**
   * The visible week lives in the URL rather than in component state, so a week
   * can be linked, shared in Slack, bookmarked, and reached by a screenshot
   * tool. Absent means the current week, which keeps the default URL clean.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const anchor = useMemo(
    () => parseWeekParam(searchParams.get("week")) ?? new Date(),
    [searchParams],
  );
  const [entries, setEntries] = useState<CalEntry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const { data: creatives } = useGetCreatives();

  const start = useMemo(() => weekStart(anchor), [anchor]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)),
    [start],
  );
  const end = useMemo(() => {
    const e = new Date(days[6]);
    e.setHours(23, 59, 59, 999);
    return e;
  }, [days]);

  const nameFor = useCallback(
    (id: string) => creatives?.data?.find((c) => c.id === id)?.name ?? "Untitled",
    [creatives],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCalendarEntries({ start: start.toISOString(), end: end.toISOString() })
      .then((data) => {
        if (!cancelled) setEntries((data.entries ?? []) as CalEntry[]);
      })
      .catch((err) => console.error("Pipeline: failed to load entries", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  /**
   * Thumbnails live on variants, and there is no bulk variant endpoint, so this
   * fetches one request per distinct creative in the visible week and caches
   * the result. At this team's volume that is a handful of parallel requests.
   * A bulk endpoint would be a small, worthwhile backend follow-up.
   */
  useEffect(() => {
    const ids = [...new Set(entries.map((e) => e.creativeId))].filter((id) => !(id in thumbs));
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.all(
      ids.map((id) =>
        apiFetch(`/api/creatives/${id}/variants`)
          .then((r) => (r.ok ? r.json() : null))
          .then((body) => {
            const list = Array.isArray(body) ? body : (body?.data ?? body?.variants ?? []);
            const first = list?.[0];
            return [id, first?.compositedImageUrl ?? first?.rawImageUrl ?? null] as const;
          })
          .catch(() => [id, null] as const),
      ),
    ).then((pairs) => {
      if (!cancelled) setThumbs((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
  }, [entries, thumbs]);

  /** Entries grouped into one card per creative per day. */
  const cardsByDay = useMemo(() => {
    const now = new Date();
    const out: PipelineCard[][] = days.map(() => []);
    for (const [dayIndex, day] of days.entries()) {
      const onDay = entries.filter((e) => sameDay(new Date(e.scheduledAt), day));
      const groups = new Map<string, CalEntry[]>();
      for (const e of onDay) {
        const list = groups.get(e.creativeId) ?? [];
        list.push(e);
        groups.set(e.creativeId, list);
      }
      for (const [creativeId, group] of groups) {
        const state = group
          .map((g) => stateFromPublishStatus(g.publishStatus, { scheduled: true }))
          .reduce((worst, s) => (STATE_RANK[s] > STATE_RANK[worst] ? s : worst), "published" as CreativeState);
        const earliest = new Date(
          Math.min(...group.map((g) => new Date(g.scheduledAt).getTime())),
        );
        out[dayIndex].push({
          creativeId,
          name: nameFor(creativeId),
          thumbnail: thumbs[creativeId] ?? null,
          entries: group,
          state,
          earliest,
          // Only stuck work ages. A published post is finished, not late.
          aging: state === "failed" || state === "needs_attention" ? agingDays(earliest, now) : null,
        });
      }
      out[dayIndex].sort((a, b) => a.earliest.getTime() - b.earliest.getTime());
    }
    return out;
  }, [days, entries, thumbs, nameFor]);

  /** Made, not placed. Drafts with nothing on the calendar. */
  const undated = useMemo(() => {
    const scheduledIds = new Set(entries.map((e) => e.creativeId));
    const now = new Date();
    return (creatives?.data ?? [])
      .filter((c) => !scheduledIds.has(c.id) && c.status !== "published" && c.status !== "archived")
      .slice(0, 12)
      .map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        aging: agingDays(c.updatedAt ?? c.createdAt, now),
      }));
  }, [creatives, entries]);

  const needsYou = cardsByDay.flat().filter((c) => c.state === "failed" || c.state === "needs_attention").length;
  const agingCount =
    cardsByDay.flat().filter((c) => c.aging !== null).length + undated.filter((u) => u.aging !== null).length;

  const goToWeek = (d: Date | null) => {
    const next = new URLSearchParams(searchParams);
    // Drop the parameter entirely for the current week rather than pinning it,
    // so a shared "this week" link keeps meaning this week tomorrow.
    if (d === null || weekParamFor(d) === weekParamFor(new Date())) next.delete("week");
    else next.set("week", weekParamFor(d));
    setSearchParams(next);
  };

  const shiftWeek = (weeks: number) => {
    const next = new Date(start);
    next.setDate(next.getDate() + weeks * 7);
    goToWeek(next);
  };

  const rangeLabel = `${DAY_NAMES[0]} ${days[0].getDate()} ${days[0].toLocaleString(undefined, { month: "short" })} – ${days[6].getDate()} ${days[6].toLocaleString(undefined, { month: "short" })}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3">
        <h1 className="font-display text-lg tracking-wide text-foreground">Pipeline</h1>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-dim" data-numeric>
          {rangeLabel}
          {needsYou > 0 && ` · ${needsYou} need you`}
          {agingCount > 0 && ` · ${agingCount} aging`}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            className="rounded-sm border border-border p-1 text-muted-foreground hover-elevate"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => goToWeek(null)}
            className="rounded-sm border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground hover-elevate"
          >
            This week
          </button>
          <button
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            className="rounded-sm border border-border p-1 text-muted-foreground hover-elevate"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </header>

      <div className="px-5 pt-3">
        <PublishHealthBanner />
      </div>

      <div className="flex min-h-0 flex-1 gap-0">
        {/* Undated work. A rail, so nothing falls off the bottom of a queue. */}
        <aside className="flex w-[190px] shrink-0 flex-col border-r border-border/60 bg-surround">
          <div className="px-3 pb-2 pt-4">
            <h2 className="font-display text-[13px] uppercase tracking-[0.09em] text-foreground">
              Not scheduled
            </h2>
            <p className="mt-0.5 text-[10px] leading-snug text-dim">Made, not placed.</p>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-4">
            {undated.length === 0 && (
              <p className="text-[10.5px] leading-snug text-dim">
                Nothing waiting. Everything you have made is on the calendar.
              </p>
            )}
            {undated.map((u) => (
              <Link
                key={u.id}
                href="/"
                className="block cursor-grab rounded-sm border border-border/60 bg-card px-2.5 py-2 transition-colors hover:border-grit-teal/50"
              >
                <p className="line-clamp-2 text-[11.5px] leading-tight text-muted-foreground">{u.name}</p>
                {u.aging !== null ? (
                  <StateChip state="needs_attention" label={`Waiting ${u.aging}d`} className="mt-1.5" />
                ) : (
                  <StateChip state="drafting" className="mt-1.5" />
                )}
              </Link>
            ))}
          </div>
          <p className="border-t border-border/60 px-3 py-2 font-mono text-[8.5px] leading-relaxed tracking-[0.06em] text-dim">
            Undated work stays visible
          </p>
        </aside>

        {/* The week. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid min-w-[900px] grid-cols-7 border-b border-border/60">
            {days.map((d, i) => {
              const isToday = sameDay(d, new Date());
              return (
                <div key={i} className="border-r border-border/60 px-2.5 py-2 last:border-r-0">
                  <p
                    className={cn(
                      "font-mono text-[9.5px] uppercase tracking-[0.12em]",
                      isToday ? "text-grit-teal" : "text-dim",
                    )}
                  >
                    {DAY_NAMES[i]}
                    {isToday && " · today"}
                  </p>
                  <p
                    className={cn(
                      "font-display text-lg tracking-[0.03em]",
                      isToday ? "text-cyber-teal" : "text-muted-foreground",
                    )}
                    data-numeric
                  >
                    {d.getDate()}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid min-w-[900px] grid-cols-7">
            {days.map((d, i) => {
              const cards = cardsByDay[i];
              const isToday = sameDay(d, new Date());
              return (
                <div
                  key={i}
                  className={cn(
                    "min-h-[320px] space-y-2 border-r border-border/60 p-2 last:border-r-0",
                    isToday && "bg-grit-teal/[0.035]",
                  )}
                >
                  {loading &&
                    i < 2 && <Skeleton className="h-24 w-full rounded-sm" />}

                  {cards.map((c) => (
                    <Link key={c.creativeId} href="/" className="block">
                      <MediaTile
                        state={c.state}
                        src={c.thumbnail}
                        title={c.name}
                        meta={fmtTime(c.earliest)}
                        fanOut={c.entries.length}
                        agingDays={c.aging}
                        aspectClassName="aspect-[4/3]"
                        className="cursor-grab"
                      />
                    </Link>
                  ))}

                  {/* No cell is ever empty. */}
                  {!loading && cards.length === 0 && (
                    <Link
                      href="/"
                      className="block rounded-sm border border-dashed border-border p-2.5 transition-colors hover:border-grit-teal/50 hover:bg-grit-teal/5"
                    >
                      <p className="font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                        Nothing here yet
                      </p>
                      <p className="mt-1 text-[10.5px] leading-snug text-dim">
                        Start something for {DAY_NAMES[i]}
                      </p>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-4 border-t border-border/60 bg-card px-5 py-2">
        <StateChip state="planned" />
        <StateChip state="drafting" />
        <StateChip state="scheduled" />
        <StateChip state="published" />
        <StateChip state="failed" />
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
          ×N expands to per-channel
        </span>
      </footer>
    </div>
  );
}
