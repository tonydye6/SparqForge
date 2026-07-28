import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A horizontal lane with a time axis.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.16, and the Studio
 * artifact screens 13 to 15.
 *
 * This is the one genuinely new primitive the product needs, and it earns its
 * place in exactly one situation: sound has a time axis and images do not, so
 * placing a hit at 0:02 is impossible without it. Video sequences then reuse
 * it for free.
 *
 * Built generic over `durationMs` so the same component serves the audio mix,
 * the clip sequence, and any future ranged view, rather than three near-copies.
 * Positions are given in milliseconds and converted here, so callers never do
 * percentage arithmetic themselves.
 */

export interface LaneBlock {
  id: string;
  startMs: number;
  endMs: number;
  label?: string;
  sublabel?: string;
  /** Visual treatment. Sources are colour-coded and also labelled. */
  tone?: "video" | "voice" | "music" | "upload" | "library" | "neutral";
  selected?: boolean;
}

export interface LaneMarker {
  id: string;
  atMs: number;
  label?: string;
}

const TONE: Record<NonNullable<LaneBlock["tone"]>, string> = {
  video: "bg-gradient-to-br from-[#1a3a4d] to-[#12283a] border-white/10",
  voice: "bg-victory-gold/20 border-victory-gold",
  music: "bg-grit-teal/30 border-grit-teal",
  upload: "bg-gradient-to-br from-[#3a2c1a] to-[#1c1509] border-victory-gold",
  library: "bg-gradient-to-br from-[#2a1620] to-[#150a10] border-rebel-pink",
  neutral: "bg-raised border-border",
};

export interface TimelineLaneProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Row label, e.g. "Music". */
  label: string;
  /** Total span the lane represents. */
  durationMs: number;
  blocks?: LaneBlock[];
  /** Point events, e.g. an SFX hit. Drawn as narrow gold ticks. */
  markers?: LaneMarker[];
  /** Playhead position. Omit to hide. */
  playheadMs?: number;
  /** Right-hand readout, e.g. "-8 dB" or "muted". */
  trailing?: React.ReactNode;
  /** Taller lane for the video track, which carries clip thumbnails. */
  tall?: boolean;
  onBlockClick?: (id: string) => void;
  onMarkerClick?: (id: string) => void;
}

function TimelineLane({
  label,
  durationMs,
  blocks = [],
  markers = [],
  playheadMs,
  trailing,
  tall,
  onBlockClick,
  onMarkerClick,
  className,
  ...props
}: TimelineLaneProps) {
  // Guard against a zero duration producing Infinity offsets.
  const span = durationMs > 0 ? durationMs : 1;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / span) * 100))}%`;

  return (
    <div
      className={cn("grid items-center gap-2.5", className)}
      style={{ gridTemplateColumns: "62px 1fr 44px" }}
      {...props}
    >
      <span className="font-mono text-[8.5px] uppercase tracking-[0.07em] text-dim">{label}</span>

      <div
        className={cn(
          "relative rounded-sm border border-border/60 bg-background",
          tall ? "h-10" : "h-5",
        )}
        role="group"
        aria-label={label}
      >
        {blocks.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onBlockClick?.(b.id)}
            title={b.label}
            className={cn(
              "absolute inset-y-0.5 flex flex-col justify-end overflow-hidden rounded-sm border px-1 py-0.5 text-left",
              TONE[b.tone ?? "neutral"],
              b.selected && "ring-1 ring-cyber-teal",
            )}
            style={{ left: pct(b.startMs), width: pct(Math.max(0, b.endMs - b.startMs)) }}
          >
            {b.label && (
              <span className="truncate text-[9.5px] leading-tight text-foreground">{b.label}</span>
            )}
            {b.sublabel && (
              <span className="truncate font-mono text-[7px] uppercase tracking-[0.05em] text-muted-foreground">
                {b.sublabel}
              </span>
            )}
          </button>
        ))}

        {markers.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onMarkerClick?.(m.id)}
            title={m.label}
            aria-label={m.label ?? "Marker"}
            className="absolute inset-y-px w-[5px] rounded-sm bg-victory-gold shadow-[0_0_0_1px_hsl(var(--victory-gold)/0.35)]"
            style={{ left: pct(m.atMs) }}
          />
        ))}

        {typeof playheadMs === "number" && (
          <div
            className="pointer-events-none absolute -inset-y-0.5 w-px bg-cyber-teal"
            style={{ left: pct(playheadMs) }}
            aria-hidden="true"
          />
        )}
      </div>

      <span className="text-right font-mono text-[8.5px] text-muted-foreground" data-numeric>
        {trailing}
      </span>
    </div>
  );
}

/** The time ruler that sits above a stack of lanes. */
function TimelineRuler({
  durationMs,
  ticks = 7,
  className,
}: {
  durationMs: number;
  ticks?: number;
  className?: string;
}) {
  const labels = Array.from({ length: ticks }, (_, i) => {
    const ms = (durationMs / (ticks - 1)) * i;
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  });

  return (
    <div
      className={cn("grid items-center gap-2.5", className)}
      style={{ gridTemplateColumns: "62px 1fr 44px" }}
    >
      <span />
      <div className="flex justify-between border-b border-border/60 pb-1 font-mono text-[8px] text-dim">
        {labels.map((l, i) => (
          <span key={i} data-numeric>
            {l}
          </span>
        ))}
      </div>
      <span />
    </div>
  );
}

export { TimelineLane, TimelineRuler };
