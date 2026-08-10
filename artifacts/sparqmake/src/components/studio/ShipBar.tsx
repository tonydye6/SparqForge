import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Loader2 } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { useCanWrite } from "@/hooks/useAuth";

/**
 * The way out of the spine.
 *
 * WHAT WAS MISSING. Studio v2 had five stages and no exit. A post could be
 * walked all the way through, locked and approved, and the row that publishing
 * reads stayed untouched, because every stage wrote `stage_takes` and nothing
 * in the publish path has ever read one. The flow simply stopped at stage 05.
 *
 * This bar is that exit, and it is deliberately not a Publish button. Making a
 * post publishable and choosing when it goes out are different decisions, and
 * scheduling already works in the Pipeline; a second scheduler here would be a
 * second thing to keep in agreement with the first.
 *
 * THE RULE IT KEEPS: the preview is free and comes first. It says which
 * channels get what, and every place the plan falls back to a default is
 * named, before anybody presses anything. Doc 24 §8, and the same shape as the
 * reopen bar above it.
 */

interface PlannedVariant {
  platform: string;
  label: string;
  aspectRatio: string;
  caption: string;
  hookText: string | null;
  updates: boolean;
}

interface Preview {
  blocked: string[];
  warnings: string[];
  variants: PlannedVariant[];
}

export function ShipBar({
  creativeId,
  /** Bumped by the shell whenever a stage saves, so the plan re-reads. */
  revision,
  /** Called after a successful ship, because it can reset an approval. */
  onShipped,
}: {
  creativeId: string;
  revision: number;
  onShipped?: () => void;
}) {
  const canWrite = useCanWrite();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [shipped, setShipped] = useState<{ count: number; approvalReset: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/ship-preview`);
      if (!res.ok) return;
      setPreview(await res.json());
    } catch {
      // A failed preview must not block the stage below it. Worst case the bar
      // stays quiet, which is strictly better than sitting on top of the work.
    }
  }, [creativeId]);

  useEffect(() => { void load(); }, [load, revision]);

  /**
   * Anything already shipped is stale once a stage saves again.
   *
   * `revision` counts STAGE saves only. Shipping notifies the shell through
   * `onShipped` on a separate channel precisely so that this effect does not
   * fire on the ship's own refresh and wipe the message the instant it
   * appears, which is what happened when both used the same counter.
   */
  useEffect(() => { setShipped(null); }, [revision]);

  async function ship() {
    if (shipping) return;
    setShipping(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/ship`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "This post could not be made ready to publish.");
        return;
      }
      setShipped({ count: body.variants?.length ?? 0, approvalReset: Boolean(body.approvalReset) });
      await load();
      onShipped?.();
    } catch {
      setError("This post could not be made ready to publish.");
    } finally {
      setShipping(false);
    }
  }

  if (!preview) return null;

  const ready = preview.blocked.length === 0 && preview.variants.length > 0;
  const updating = preview.variants.some((v) => v.updates);

  return (
    <div className="shrink-0 border-t border-border/60 bg-card" data-testid="bar-ship">
      <div className="flex items-start gap-3 px-4 py-2.5">
        <span className="whitespace-nowrap pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.11em] text-grit-teal">
          Publishing
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          {shipped ? (
            <>
              <p className="text-[12.5px] text-foreground">
                {shipped.count === 1 ? "One channel version is" : `${shipped.count} channel versions are`} ready to
                schedule.
                {shipped.approvalReset && (
                  <span className="text-muted-foreground">
                    {" "}The earlier approval no longer covers this, so a fresh decision was asked for.
                  </span>
                )}
              </p>
              <Link href="/pipeline">
                <a className="inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.06em] text-cyber-teal hover:underline" data-testid="link-pipeline">
                  Schedule it in the Pipeline <ArrowRight size={9} />
                </a>
              </Link>
            </>
          ) : preview.blocked.length > 0 ? (
            <>
              <p className="text-[12.5px] text-foreground">This post cannot publish yet.</p>
              {preview.blocked.map((b, i) => (
                <p key={i} className="text-[12px] leading-relaxed text-rebel-pink">{b}</p>
              ))}
            </>
          ) : (
            <>
              <p className="text-[12.5px] text-foreground">
                {updating
                  ? `Ready to update ${preview.variants.length} channel ${preview.variants.length === 1 ? "version" : "versions"}.`
                  : `Ready to make ${preview.variants.length} channel ${preview.variants.length === 1 ? "version" : "versions"}.`}{" "}
                <button
                  onClick={() => setOpen((v) => !v)}
                  className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-muted-foreground underline-offset-2 hover:underline"
                  data-testid="button-toggle-ship-detail"
                >
                  {open ? "Hide" : "What goes where"}
                </button>
              </p>
              {preview.warnings.map((w, i) => (
                <p key={i} className="text-[11.5px] leading-relaxed text-muted-foreground">{w}</p>
              ))}
            </>
          )}

          {error && <p className="text-[12px] text-rebel-pink">{error}</p>}
        </div>

        {canWrite && ready && !shipped && (
          <button
            onClick={() => void ship()}
            disabled={shipping}
            className="shrink-0 rounded-sm border border-grit-teal px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-cyber-teal hover-elevate disabled:opacity-40"
            data-testid="button-ship"
          >
            {shipping ? <Loader2 size={10} className="animate-spin" /> : updating ? "Update it" : "Make it publishable"}
          </button>
        )}
      </div>

      {/*
        The per-channel detail, closed by default. Open, it is the answer to
        "what exactly will go out", which is the one thing the old flow could
        never tell anybody because there was nothing to tell.
      */}
      {open && !shipped && preview.variants.length > 0 && (
        <div className="space-y-1.5 border-t border-border/40 px-4 py-2">
          {preview.variants.map((v) => (
            <div key={v.platform} className="flex gap-3" data-testid={`ship-channel-${v.platform}`}>
              <span className={cn(
                "w-[132px] shrink-0 font-mono text-[9.5px] uppercase tracking-[0.06em]",
                v.updates ? "text-muted-foreground" : "text-cyber-teal",
              )}>
                {v.label} · {v.aspectRatio}
              </span>
              <p className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                {v.hookText && <span className="text-foreground">{v.hookText} · </span>}
                {v.caption.replace(/\n+/g, " ")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
