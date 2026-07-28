import * as React from "react";

import { cn } from "@/lib/utils";
import { CREATIVE_STATES, type CreativeState } from "@/lib/creative-state";

/**
 * The tile a creative lives in, anywhere it appears: the Pipeline, a spread,
 * a history strip, a saved run.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.8
 *
 * This is one of the four primitives the spec says to hand-author rather than
 * take from a component library, because state-as-material is the idea that
 * makes the product readable and no library ships it.
 *
 * Three things it does that a generic card does not:
 *
 * 1. State is expressed in the FRAME AND THE MEDIA, not in a badge bolted on
 *    top. A planned tile has no image at all; a draft is desaturated.
 * 2. `fanOut` renders the ×N affordance, because the unit of work here is one
 *    creative going to several channels rather than N separate posts.
 * 3. `agingDays` draws a pink bar across the top. Nothing else in this
 *    category shows you what has been sitting still.
 */
export interface MediaTileProps extends React.HTMLAttributes<HTMLDivElement> {
  state: CreativeState;
  /** Artwork. Omitted or absent for planned work, which shows an outline. */
  src?: string | null;
  alt?: string;
  title?: string;
  /** Time, channel, or whatever the surface needs under the title. */
  meta?: React.ReactNode;
  /** Channel count for the grouped ×N badge. Hidden when 1 or undefined. */
  fanOut?: number;
  /** Days this has been stuck. Draws the aging bar. Null hides it. */
  agingDays?: number | null;
  /** Where the bar saturates. Past this, aging reads as "as bad as it gets". */
  agingCeiling?: number;
  onFanOutClick?: () => void;
  /** Tailwind aspect ratio class. Defaults to square. */
  aspectClassName?: string;
}

function MediaTile({
  state,
  src,
  alt,
  title,
  meta,
  fanOut,
  agingDays = null,
  agingCeiling = 10,
  onFanOutClick,
  aspectClassName = "aspect-square",
  className,
  ...props
}: MediaTileProps) {
  const spec = CREATIVE_STATES[state];
  const showMedia = spec.showsMedia && Boolean(src);
  const agePct =
    agingDays === null ? 0 : Math.min(100, Math.round((agingDays / agingCeiling) * 100));

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-sm bg-card transition-colors",
        spec.frame,
        className,
      )}
      {...props}
    >
      {/* Aging. Drawn, not buried in a tooltip. */}
      {agingDays !== null && (
        <div
          className="absolute inset-x-0 top-0 z-10 h-0.5 bg-border"
          role="img"
          aria-label={`Stuck for ${agingDays} days`}
        >
          <div className="h-full bg-rebel-pink" style={{ width: `${agePct}%` }} />
        </div>
      )}

      <div className={cn("relative w-full overflow-hidden", aspectClassName)}>
        {showMedia ? (
          <img
            src={src as string}
            alt={alt ?? title ?? ""}
            loading="lazy"
            className={cn("size-full object-cover", spec.media)}
          />
        ) : (
          // Planned work. No image, and the empty frame is the message.
          <div className="flex size-full items-center justify-center">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
              {spec.label}
            </span>
          </div>
        )}
      </div>

      {(title || meta || (fanOut && fanOut > 1)) && (
        <div className="space-y-1 px-2 py-1.5">
          {title && <p className="truncate text-[11px] leading-tight text-foreground">{title}</p>}
          <div className="flex items-center gap-1.5">
            {meta && (
              <span className="font-mono text-[9px] tracking-[0.05em] text-dim" data-numeric>
                {meta}
              </span>
            )}
            {typeof fanOut === "number" && fanOut > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFanOutClick?.();
                }}
                title={`Goes to ${fanOut} channels. Click to expand.`}
                className="ml-auto rounded-sm border border-border px-1 font-mono text-[9px] tracking-[0.05em] text-muted-foreground transition-colors hover:border-grit-teal/50 hover:text-cyber-teal"
              >
                ×{fanOut}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { MediaTile };
