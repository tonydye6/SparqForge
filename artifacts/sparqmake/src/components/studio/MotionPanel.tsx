/**
 * Phase 9 item 9 · stage 03 in its other medium.
 *
 * The spine does not gain a stage. Stage 03 gains a MEDIUM, because a separate
 * video stage would make one post look like two pipelines and the five stages
 * are fixed display order (doc 24 §3, Tony's own framing of the spine).
 *
 * **The still is never consumed.** Converting is additive: the image variant
 * stays exactly where it was and the motion points back at it, which is what
 * `sourceImageVariantId` records and what lets a channel take either medium
 * from one creative (doc 21 §4.5).
 *
 * **The distinction this panel exists to draw** is between a clip that IS this
 * still in motion and a clip that merely also exists for the same channel. Only
 * the lineage can tell those apart, and presenting them alike would offer
 * "image or video" as two formats of one idea when sometimes they are two
 * different ideas.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface MediumChoice {
  platform: string;
  imageVariantId: string | null;
  motionVariantId: string | null;
  motionFromThisImage: boolean;
}

export function MotionPanel({ creativeId }: { creativeId: string }) {
  const [choices, setChoices] = useState<MediumChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/media`);
      if (!resp.ok) throw new Error(`The media for this creative could not be read (${resp.status}).`);
      const body = await resp.json();
      setChoices(body.choices ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The media for this creative could not be read.");
    }
  }, [creativeId]);

  useEffect(() => { void load(); }, [load]);

  const withMotion = (choices ?? []).filter(c => c.motionVariantId);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="space-y-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-grit-teal">
          Stage 03 · Motion
        </p>
        <h2 className="font-display text-xl tracking-wide text-foreground">
          The same stage, moving
        </h2>
        <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted-foreground">
          Motion is a medium of this stage, not a stage of its own. Whatever is here was animated
          from a still that is still sitting under the Image tab, so switching back costs nothing.
        </p>
      </div>

      {error && (
        <p className="rounded-sm border border-destructive/50 bg-raised px-2.5 py-1.5 text-[12px] text-destructive">
          {error}
        </p>
      )}

      {choices !== null && withMotion.length === 0 && (
        /*
          No fake Convert button. Converting a still to a clip runs as a turn in
          the Co-pilot today and there is no stage route for it, so offering the
          action here would be a control that does nothing. Doc 24 §4: a thing
          that is half-built and pretending to work is worse than one honestly
          absent.
        */
        <div className="rounded-sm border border-border/60 bg-raised px-3 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            No motion for this creative yet. A clip is made by converting a still in the Co-pilot,
            which animates the take you keep and leaves the still untouched.
          </p>
        </div>
      )}

      {withMotion.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {withMotion.map(choice => (
            <div key={choice.platform} className="rounded-sm border border-border bg-raised p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-foreground">{choice.platform}</span>
                <span
                  className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.09em] ${
                    choice.motionFromThisImage
                      ? "border-grit-teal text-cyber-teal"
                      : "border-rebel-pink text-rebel-pink"
                  }`}
                >
                  {choice.motionFromThisImage ? "from this still" : "different take"}
                </span>
              </div>

              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {choice.motionFromThisImage
                  ? "This clip is the still in motion, so either medium ships the same post."
                  : choice.imageVariantId
                    /*
                      The case only the lineage can answer, and the reason this
                      panel is worth having. Unrecorded lineage lands here too:
                      not knowing and yes must not read the same.
                    */
                    ? "This clip came from a different take, so choosing motion ships a different picture rather than a moving version of the still."
                    : "There is a clip for this channel but no still beside it."}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
