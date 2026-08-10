import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The home for explanation that used to sit on the screen as paragraphs.
 *
 * Tony, 2026-08-10: "if you have to explain the ux/ui to the user, then that
 * means the ux/ui simply isn't good enough" — and anything that genuinely
 * needs a longer story gets an info icon that tells it on hover, instead of
 * occupying the screen permanently. Labels say what a thing IS; this carries
 * the WHY for whoever wants it; nothing else renders as standing copy.
 *
 * One component rather than ad-hoc tooltips so the affordance looks the same
 * everywhere and the next surface does not invent its own.
 */
export function InfoDot({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More about this"
          className={`inline-flex shrink-0 items-center text-dim transition-colors hover:text-muted-foreground ${className ?? ""}`}
          data-testid="info-dot"
        >
          <Info size={11} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[340px] text-[11.5px] leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
