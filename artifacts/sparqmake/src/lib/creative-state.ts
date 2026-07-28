/**
 * The single source of truth for how a creative's state looks.
 *
 * Spec: SparqMake Sandbox/20_SPEC_00_PRINCIPLES.md §1.8
 *
 * The rule this file encodes: STATE IS MATERIAL, NOT BADGES. A planned item is
 * an empty dashed outline. A draft is desaturated. Something scheduled carries
 * a teal edge, published carries gold, and anything needing you carries pink.
 * The point is that a week of work should read from across the room without
 * anyone decoding a legend.
 *
 * Two consequences worth respecting when you add a state:
 *
 * 1. Every state ALSO carries a text label, because colour alone is not a
 *    signal (§4.4). `label` is not optional and must never be dropped from a
 *    surface in favour of the colour by itself.
 *
 * 2. Pink is the only warning hue in the product, and Outlaw Red is reserved
 *    for destructive actions and the parent brand. If a new state seems to
 *    want red, it wants pink.
 */

export type CreativeState =
  | "planned"
  | "drafting"
  | "ready"
  | "scheduled"
  | "published"
  | "needs_attention"
  | "failed";

export interface CreativeStateSpec {
  /** Human label. Required: colour is never the only signal. */
  label: string;
  /** Classes applied to the tile frame. This is the "material" treatment. */
  frame: string;
  /** Classes applied to the imagery inside the frame. */
  media: string;
  /** Whether imagery is shown at all. Planned work has none yet. */
  showsMedia: boolean;
  /** Foreground colour for the matching chip and any inline mention. */
  text: string;
  /** Small solid swatch for the chip dot. */
  dot: string;
}

export const CREATIVE_STATES: Record<CreativeState, CreativeStateSpec> = {
  planned: {
    label: "Planned",
    // No image yet, so the frame itself is the whole signal.
    frame: "border border-dashed border-border bg-transparent",
    media: "",
    showsMedia: false,
    text: "text-dim",
    dot: "bg-dim",
  },
  drafting: {
    label: "Drafting",
    frame: "border border-border/60",
    // Desaturated rather than dimmed: a draft should read as unfinished
    // colour, not as a darker version of the finished thing.
    media: "saturate-[0.18] brightness-[0.62]",
    showsMedia: true,
    text: "text-dim",
    dot: "bg-dim",
  },
  ready: {
    label: "Ready",
    frame: "border border-white/10",
    media: "",
    showsMedia: true,
    text: "text-foreground",
    dot: "bg-muted-foreground",
  },
  scheduled: {
    label: "Scheduled",
    frame: "shadow-[inset_0_0_0_1.5px_hsl(var(--grit-teal))]",
    media: "",
    showsMedia: true,
    text: "text-grit-teal",
    dot: "bg-grit-teal",
  },
  published: {
    label: "Published",
    // Slightly softer edge than scheduled: shipped work should settle back
    // rather than keep asking for attention.
    frame: "shadow-[inset_0_0_0_1px_hsl(var(--victory-gold)/0.55)]",
    media: "saturate-[0.85]",
    showsMedia: true,
    text: "text-victory-gold",
    dot: "bg-victory-gold",
  },
  needs_attention: {
    label: "Needs you",
    frame: "shadow-[inset_0_0_0_1.5px_hsl(var(--rebel-pink))]",
    media: "",
    showsMedia: true,
    text: "text-rebel-pink",
    dot: "bg-rebel-pink",
  },
  failed: {
    label: "Failed",
    // Same material as needs_attention on purpose. A failure and a request for
    // review are both "this will not move without you", and the label carries
    // the difference.
    frame: "shadow-[inset_0_0_0_1.5px_hsl(var(--rebel-pink))]",
    media: "saturate-[0.4]",
    showsMedia: true,
    text: "text-rebel-pink",
    dot: "bg-rebel-pink",
  },
};

/**
 * Maps the publish status already stored on `calendar_entries` onto a state.
 * Kept here so the mapping is not reinvented per surface.
 */
export function stateFromPublishStatus(
  status: string | null | undefined,
  opts: { scheduled?: boolean } = {},
): CreativeState {
  switch (status) {
    case "published":
      return "published";
    case "failed":
      return "failed";
    case "pending":
    case "scheduled":
      return "scheduled";
    default:
      return opts.scheduled ? "scheduled" : "drafting";
  }
}

/**
 * How stale is stale enough to draw. Returns null when the work is young
 * enough that flagging it would be noise.
 *
 * Aging is the biggest unclaimed gap in this product category: every tool
 * shows you what is scheduled and none of them show you what has been sitting
 * still. The threshold is deliberately generous so the signal keeps meaning
 * something.
 */
export function agingDays(since: Date | string, now: Date): number | null {
  const then = typeof since === "string" ? new Date(since) : since;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  return days >= 3 ? days : null;
}
