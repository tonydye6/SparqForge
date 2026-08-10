/**
 * Phase 9 item 8 · the timeline primitive.
 *
 * Lanes, per-track level, ducked spans, and hits that stay where they are put.
 * Presentational on purpose: it takes the read model `GET /api/sequences/:id`
 * returns and draws it. Everything arguable, including the duck windows and the
 * warnings, is computed on the server by `mixer.ts` and `sequence-plan.ts`, so
 * the picture and the render cannot disagree about what the mix is.
 *
 * Three things here earn their place, and all three come from the data:
 *
 * **The ducked span is drawn before anything renders.** Only possible because
 * the duck is scheduled from the voice's own timing rather than decided by a
 * compressor at render time.
 *
 * **A track with no length yet is drawn dashed and labelled as an estimate**,
 * with no waveform, because nothing has been generated to draw. A placeholder
 * wave would be inventing a signal.
 *
 * **SFX are hits, not blocks, and they are free.** Tony's call: a whistle rarely
 * lands exactly on a cut, so they are not snapped to clip boundaries.
 */
import { useState } from "react";
import { SparqSkull } from "@/components/ui/generation-indicator";

export interface TimelineClip {
  id: string;
  position: number;
  durationMs: number;
  timelineStartMs: number;
  overlapMs: number;
  transitionIn: "cut" | "dissolve";
  sourceKind: "generated" | "library_asset" | "upload";
  /** The file this clip pointed at was deleted underneath it. */
  sourceMissing: boolean;
}

export interface TimelineTrack {
  id: string;
  trackKind: "voice" | "music" | "sfx" | "native";
  startMs: number;
  durationMs: number | null;
  gainDb: number;
  duckUnder: string | null;
  duckWindows: Array<{ startMs: number; endMs: number }>;
  /** True while the track is still being generated, so its length is unknown. */
  pending: boolean;
}

export interface TimelineData {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  totalDurationMs: number;
  /** False when a clip has lost its source. Distinct from having warnings. */
  renderable: boolean;
  warnings: string[];
}

const KIND_LABEL: Record<TimelineTrack["trackKind"], string> = {
  voice: "Voice",
  music: "Music",
  sfx: "SFX",
  native: "Clip audio",
};

const SOURCE_LABEL: Record<TimelineClip["sourceKind"], string> = {
  generated: "generated",
  library_asset: "library",
  upload: "uploaded",
};

const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

/** Percent of the timeline, guarded so a zero-length sequence cannot divide by zero. */
function pct(ms: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.max(0, Math.min(100, (ms / totalMs) * 100));
}

/**
 * Where a still-generating track is drawn.
 *
 * It has no real length, so the block is the ESTIMATE, drawn dashed. Falling
 * back to a fixed slice keeps a pending track visible rather than collapsing it
 * to nothing, which would read as "no track" instead of "not finished".
 */
const PENDING_ESTIMATE_MS = 4800;

function Ruler({ totalMs }: { totalMs: number }) {
  const step = totalMs > 30_000 ? 5000 : 2000;
  const marks: number[] = [];
  for (let ms = 0; ms <= totalMs; ms += step) marks.push(ms);
  return (
    <div className="relative h-6 border-b border-border bg-card">
      {marks.map(ms => (
        <div key={ms} className="absolute inset-y-0" style={{ left: `${pct(ms, totalMs)}%` }}>
          <div className="h-full w-px bg-border" />
          <span
            className="absolute top-1.5 translate-x-1 font-mono text-[8px] tracking-[0.06em] text-dim"
            data-numeric
          >
            {ms / 1000}s
          </span>
        </div>
      ))}
    </div>
  );
}

function ClipLane({
  clips,
  totalMs,
  onReorder,
}: {
  clips: TimelineClip[];
  totalMs: number;
  onReorder?: (order: string[]) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  /*
   * Reordering sends the WHOLE order, not a moved-from/moved-to pair. The
   * server refuses a partial order, because clips it was not told about would
   * end up somewhere nobody chose.
   */
  const drop = (targetId: string): void => {
    if (!onReorder || !dragging || dragging === targetId) return;
    const ids = clips.map(c => c.id).filter(id => id !== dragging);
    const at = ids.indexOf(targetId);
    ids.splice(at < 0 ? ids.length : at, 0, dragging);
    setDragging(null);
    setOver(null);
    onReorder(ids);
  };

  return (
    <div className="grid grid-cols-[128px_1fr] border-b border-border">
      <div className="flex flex-col justify-center gap-0.5 border-r border-border bg-card px-3 py-2">
        <span className="text-xs text-foreground">Clips</span>
        <span className="font-mono text-[8.5px] tracking-[0.07em] text-dim">
          {clips.length} · video
        </span>
      </div>
      <div className="relative h-[46px]">
        {clips.map(clip => (
          <div
            key={clip.id}
            draggable={Boolean(onReorder)}
            onDragStart={() => setDragging(clip.id)}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            onDragOver={e => { if (onReorder) { e.preventDefault(); setOver(clip.id); } }}
            onDrop={e => { e.preventDefault(); drop(clip.id); }}
            className={`absolute inset-y-1.5 overflow-hidden rounded-sm border ${
              onReorder ? "cursor-grab active:cursor-grabbing" : ""
            } ${dragging === clip.id ? "opacity-40" : ""} ${
              over === clip.id && dragging && dragging !== clip.id ? "ring-1 ring-cyber-teal" : ""
            } ${
              clip.sourceMissing
                /* Hatched and pink: it holds its slot but it is not going to
                   play, and the only warning hue in the system says so. */
                ? "border-dashed border-rebel-pink bg-[repeating-linear-gradient(135deg,hsl(var(--rebel-pink)/0.16)_0_5px,transparent_5px_10px)]"
                : "border-card-border bg-raised-2"
            }`}
            style={{
              left: `${pct(clip.timelineStartMs, totalMs)}%`,
              width: `${pct(clip.durationMs, totalMs)}%`,
            }}
            title={
              clip.sourceMissing
                ? "The file this clip pointed at was deleted. Replace it or remove it."
                : `${SOURCE_LABEL[clip.sourceKind]} · ${secs(clip.durationMs)}`
            }
          >
            <span
              className={`absolute left-1.5 top-1 font-mono text-[8px] tracking-[0.07em] ${
                clip.sourceMissing ? "text-rebel-pink" : "text-muted-foreground"
              }`}
            >
              {clip.sourceMissing ? "file missing" : `${SOURCE_LABEL[clip.sourceKind]} · ${secs(clip.durationMs)}`}
            </span>
            {/* A dissolve overlaps the clip before it. Drawn on the incoming
                clip's leading edge, which is where the overlap actually is. */}
            {clip.overlapMs > 0 && (
              <span
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyber-teal/40 to-transparent"
                style={{ width: `${(clip.overlapMs / clip.durationMs) * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TrackLane({ track, totalMs }: { track: TimelineTrack; totalMs: number }) {
  const isHits = track.trackKind === "sfx";
  const lengthMs = track.durationMs ?? PENDING_ESTIMATE_MS;

  const tone =
    track.trackKind === "voice" ? "border-grit-teal bg-grit-teal/15 text-cyber-teal"
    : track.trackKind === "music" ? "border-victory-gold/40 bg-victory-gold/10 text-victory-gold"
    : "border-card-border bg-raised text-muted-foreground";

  return (
    <div className="grid grid-cols-[128px_1fr] border-b border-border last:border-b-0">
      <div className="flex flex-col justify-center gap-0.5 border-r border-border bg-card px-3 py-2">
        <span className="text-xs text-foreground">{KIND_LABEL[track.trackKind]}</span>
        <span
          className={`font-mono text-[8.5px] tracking-[0.07em] ${track.pending ? "text-cyber-teal" : "text-dim"}`}
          data-numeric
        >
          {track.pending
            ? "Generating"
            /* Signed, and always to one decimal, so a column of levels lines up
               and 0 reads as a deliberate unity rather than an empty field. */
            : `${track.gainDb > 0 ? "+" : ""}${track.gainDb.toFixed(1)} dB`}
        </span>
      </div>

      <div className="relative h-[46px]">
        {isHits ? (
          /*
             Hits, not a block. Free rather than snapped to clip boundaries, so
             they sit exactly where they were placed.
          */
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-rebel-pink"
            style={{ left: `${pct(track.startMs, totalMs)}%` }}
            title={`Hit at ${secs(track.startMs)}`}
          />
        ) : (
          <div
            className={`absolute inset-y-1.5 overflow-hidden rounded-sm border ${tone} ${
              track.pending ? "border-dashed" : ""
            }`}
            style={{
              left: `${pct(track.startMs, totalMs)}%`,
              width: `${pct(lengthMs, totalMs)}%`,
            }}
          >
            {track.pending ? (
              <span className="flex h-full items-center gap-1.5 px-2">
                <SparqSkull className="size-3 shrink-0 fill-cyber-teal motion-safe:animate-flicker" />
                <span className="truncate font-mono text-[8px] tracking-[0.06em] text-cyber-teal">
                  about {secs(lengthMs)} estimated
                </span>
              </span>
            ) : (
              <Waveform seed={track.id} />
            )}

            {track.duckWindows.map((w, i) => (
              <span
                key={i}
                className="absolute inset-y-0 border-x border-cyber-teal bg-[repeating-linear-gradient(135deg,hsl(var(--cyber-teal)/0.18)_0_4px,transparent_4px_8px)]"
                style={{
                  left: `${((w.startMs - track.startMs) / lengthMs) * 100}%`,
                  width: `${((w.endMs - w.startMs) / lengthMs) * 100}%`,
                }}
                title={`Ducked ${secs(w.startMs)} to ${secs(w.endMs)}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A waveform that is the same every render.
 *
 * Deterministic from the track id rather than random, so the picture does not
 * change under someone while they are looking at it. It is decorative: the real
 * signal is not available client-side, and pretending otherwise on a track that
 * HAS rendered is a much smaller lie than drawing one that has not.
 */
function Waveform({ seed }: { seed: string }) {
  const base = [...seed].reduce((n, c) => n + c.charCodeAt(0), 0);
  const bars = Array.from({ length: 48 }, (_, i) =>
    Math.abs(Math.sin((i + base) * 0.7) * 0.55 + Math.sin((i + base) * 0.23) * 0.4),
  );
  return (
    <span className="absolute inset-0 flex items-center gap-px px-1" aria-hidden="true">
      {bars.map((v, i) => (
        <span key={i} className="flex-1 rounded-[1px] bg-current opacity-50" style={{ height: `${14 + v * 62}%` }} />
      ))}
    </span>
  );
}

export function Timeline({
  data,
  onReorder,
}: {
  data: TimelineData;
  /** Given the new full order of clip ids. Omit to leave clips undraggable. */
  onReorder?: (order: string[]) => void;
}) {
  const totalMs = data.totalDurationMs;

  if (data.clips.length === 0 && data.tracks.length === 0) {
    return (
      <p className="rounded-sm border border-border/50 bg-raised px-3 py-2 text-[12px] text-muted-foreground">
        Nothing in this sequence yet. Add a clip to start.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-sm border border-border bg-background">
        <div className="grid grid-cols-[128px_1fr] items-center border-b border-border bg-card">
          <span className="px-3 py-1.5 font-mono text-[8.5px] tracking-[0.07em] text-dim" data-numeric>
            0 · {secs(totalMs)}
          </span>
          <Ruler totalMs={totalMs} />
        </div>

        <ClipLane clips={data.clips} totalMs={totalMs} onReorder={onReorder} />
        {data.tracks.map(track => (
          <TrackLane key={track.id} track={track} totalMs={totalMs} />
        ))}
      </div>

      {/*
        The mixer's and the assembler's own refusals, in their own words. These
        existed in the services from the day they landed and had nowhere to
        appear, which is the whole reason a duck could silently not happen.
      */}
      {data.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {data.warnings.map((w, i) => (
            <li
              key={i}
              className="rounded-sm border border-rebel-pink/50 bg-raised px-2.5 py-1.5 text-[11.5px] leading-relaxed text-rebel-pink"
            >
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
