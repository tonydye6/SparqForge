import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * What you look at while the model works.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.6, §1.17, §4.5
 * and the Studio artifact, screen 03.
 *
 * The whole novelty budget for the product is spent here and nowhere else,
 * which is why every other surface can afford to be quiet.
 *
 * The load-bearing detail is `protecting`. A spinner says "wait". This says
 * what the model has been told it may not change, e.g. "holding the crown mark
 * exactly". That turns dead time into the one moment the user can actually see
 * the brand contract being enforced, which is §1.17 (nothing sent to the model
 * is hidden) expressed as a loading state.
 *
 * NOTE ON THE MARK: the path below is a working approximation of the SparqMake
 * flaming skull, drawn from the raster logo. It should be replaced with the
 * real vector once Tony supplies the teal SVG source, which is not in the repo.
 * Swap only the <path> and leave the sizing and animation alone.
 */

export interface GenerationIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Verb shown under the mark. "Forging" by default. */
  verb?: string;
  /**
   * What is being held constant. This is the point of the component, so it is
   * strongly encouraged even though it is optional for the trivial cases.
   */
  protecting?: string;
  /** Elapsed seconds. Shown as an honest counter, not a fake progress bar. */
  elapsedSec?: number;
  /**
   * Real progress 0 to 1 when the model actually reports it. Left undefined
   * the bar is omitted entirely rather than animating a lie.
   */
  progress?: number;
  size?: "sm" | "md";
}

function SparqSkull({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 2C7.6 2 4 5.4 4 9.6c0 2.3 1 4.3 2.6 5.7V19h2.2v2h2v-2h2.4v2h2v-2H17v-3.7c1.6-1.4 2.6-3.4 2.6-5.7C19.6 5.4 16.4 2 12 2zM9 11.4a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm6 0a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" />
    </svg>
  );
}

function GenerationIndicator({
  verb = "Forging",
  protecting,
  elapsedSec,
  progress,
  size = "md",
  className,
  ...props
}: GenerationIndicatorProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        size === "sm" ? "p-4" : "p-8",
        className,
      )}
      role="status"
      aria-live="polite"
      {...props}
    >
      <SparqSkull
        className={cn(
          "fill-cyber-teal drop-shadow-[0_0_14px_hsl(var(--cyber-teal)/0.5)] motion-safe:animate-flicker",
          size === "sm" ? "size-8" : "size-16",
        )}
      />

      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-cyber-teal">{verb}</p>

      {protecting && (
        <p className="max-w-[36ch] font-mono text-[10px] uppercase leading-relaxed tracking-[0.05em] text-muted-foreground">
          {protecting}
        </p>
      )}

      {/* Only drawn when the model reports something real. An indeterminate bar
          that fills on a timer is a lie about progress. */}
      {typeof progress === "number" && (
        <div className="h-0.5 w-48 overflow-hidden bg-border">
          <div
            className="h-full bg-cyber-teal transition-[width] duration-500"
            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
          />
        </div>
      )}

      {typeof elapsedSec === "number" && (
        <p className="font-mono text-[10px] tracking-[0.04em] text-dim" data-numeric>
          {elapsedSec}s
        </p>
      )}
    </div>
  );
}

export { GenerationIndicator, SparqSkull };
