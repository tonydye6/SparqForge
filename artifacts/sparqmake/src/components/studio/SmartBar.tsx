import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ChevronsRight } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";

/**
 * The Smart Bar: the proactive side of the sidebar.
 *
 * Spec: the approved mock (artifact 6056f09f, screen 4) and the agreed
 * mechanism — the trigger is the stage EVENT STREAM, never screenshots.
 * The bar re-reads on every spine revision, which is exactly "the work
 * itself woke it": a stage save is the event.
 *
 * What the contract guarantees, and the UI keeps visible:
 *   - every card opens with WHAT IT SAW, in mono, before its opinion;
 *   - one action per card, executable or navigational;
 *   - the "what it saw" feed at the bottom is §1.17 applied to the bar
 *     itself — its entire input, inspectable;
 *   - a healthy session renders NO cards, and the bar says nothing rather
 *     than inventing advice. A bar that always talks gets ignored.
 */

interface BarEvent {
  at: string;
  kind: string;
  line: string;
}

interface BarCard {
  id: string;
  saw: string;
  tone: "risk" | "note";
  text: string;
  action:
    | { type: "open_stage"; stageKind: string; label: string }
    | { type: "href"; href: string; label: string }
    | null;
}

export function SmartBar({
  creativeId,
  revision,
  onOpenStage,
}: {
  creativeId: string;
  /** Bumped on every stage save; each bump is an event, so the bar re-reads. */
  revision: number;
  onOpenStage: (stageKind: string) => void;
}) {
  const [events, setEvents] = useState<BarEvent[]>([]);
  const [cards, setCards] = useState<BarCard[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/smart-bar`);
      if (!res.ok) return;
      const body = await res.json();
      setEvents(body.events ?? []);
      setCards(body.cards ?? []);
    } catch {
      // The bar is a colleague, not a dependency. Silence over a spinner.
    }
  }, [creativeId]);

  useEffect(() => { void load(); }, [load, revision]);

  const visible = cards.filter((c) => !dismissed.has(c.id));

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center gap-2 border-t border-border/60 px-3 py-2 text-left hover:bg-muted/30"
        data-testid="button-expand-smart-bar"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", visible.length ? "bg-cyber-teal" : "bg-border")} />
        <span className="font-mono text-[9px] uppercase tracking-[0.11em] text-dim">
          Smart bar{visible.length > 0 && ` · ${visible.length}`}
        </span>
      </button>
    );
  }

  return (
    <div className="flex min-h-0 flex-col border-t border-border/60" data-testid="smart-bar">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", visible.length ? "animate-pulse bg-cyber-teal" : "bg-border")} />
        <span className="flex-1 font-mono text-[9px] uppercase tracking-[0.11em] text-grit-teal">Smart bar</span>
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Collapse the smart bar"
          className="text-dim hover:text-muted-foreground"
          data-testid="button-collapse-smart-bar"
        >
          <ChevronsRight size={11} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-2">
        {visible.map((card) => (
          <div
            key={card.id}
            className={cn(
              "rounded-sm border bg-raised px-2.5 py-2",
              card.tone === "risk" ? "border-rebel-pink/40" : "border-border",
            )}
            data-testid={`smart-card-${card.id}`}
          >
            <p className="mb-1 font-mono text-[8px] uppercase tracking-[0.08em] text-dim">
              saw{" "}
              <span className={card.tone === "risk" ? "text-rebel-pink" : "text-grit-teal"}>{card.saw}</span>
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{card.text}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              {card.action?.type === "open_stage" && (
                <button
                  onClick={() => onOpenStage(card.action!.type === "open_stage" ? card.action!.stageKind : "")}
                  className="rounded-sm border border-grit-teal px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.06em] text-cyber-teal hover-elevate"
                >
                  {card.action.label}
                </button>
              )}
              {card.action?.type === "href" && (
                <Link href={card.action.href}>
                  <a className="rounded-sm border border-grit-teal px-2 py-0.5 font-mono text-[8px] uppercase tracking-[0.06em] text-cyber-teal hover-elevate">
                    {card.action.label}
                  </a>
                </Link>
              )}
              <button
                onClick={() => setDismissed((prev) => new Set(prev).add(card.id))}
                className="px-1 font-mono text-[8px] uppercase tracking-[0.06em] text-dim hover:text-muted-foreground"
              >
                Not now
              </button>
            </div>
          </div>
        ))}
      </div>

      {events.length > 0 && (
        <div className="max-h-[110px] overflow-y-auto border-t border-border/40 px-3 py-2">
          <p className="mb-1 font-mono text-[8px] uppercase tracking-[0.1em] text-dim">What it saw</p>
          <ul>
            {events.map((e, i) => (
              <li key={i} className="font-mono text-[8.5px] leading-[1.9] text-dim">
                {e.line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
