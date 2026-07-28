import * as React from "react";

import { cn } from "@/lib/utils";
import { CREATIVE_STATES, type CreativeState } from "@/lib/creative-state";

/**
 * A state label. Deliberately not a Badge.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.8, §4.4
 *
 * Badge is a decorative pill with a filled background, which competes with the
 * imagery it sits next to and makes every state shout equally. This is quieter
 * on purpose: a dot carries the colour, the text carries the meaning, and the
 * chip recedes so the artwork is what you look at.
 *
 * The dot is never the only signal. If you find yourself wanting to hide the
 * label to save space, the answer is fewer chips, not a colour-only chip.
 */
export interface StateChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  state: CreativeState;
  /** Overrides the default label. Use for things like "Stuck 6d". */
  label?: string;
  /** Drops the dot when the surrounding frame already carries the colour. */
  hideDot?: boolean;
}

function StateChip({ state, label, hideDot, className, ...props }: StateChipProps) {
  const spec = CREATIVE_STATES[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[9.5px] uppercase tracking-[0.08em]",
        spec.text,
        className,
      )}
      {...props}
    >
      {!hideDot && <span className={cn("size-1.5 shrink-0 rounded-full", spec.dot)} aria-hidden="true" />}
      {label ?? spec.label}
    </span>
  );
}

export { StateChip };
