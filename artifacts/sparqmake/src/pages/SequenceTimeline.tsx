/**
 * Phase 9 · the sequence screen.
 *
 * Deliberately its own route rather than folded into stage 03 straight away.
 * Doc 22 item 9 (stage 03 becoming medium-polymorphic) is a separate item, and
 * putting an unproven timeline inside the spine would put the riskiest new
 * surface in the path of every existing still post. Studio v2 sits beside
 * Studio for the same reason.
 */
import { useCallback, useEffect, useState } from "react";
import { useRoute } from "wouter";
import { apiFetch } from "@/lib/utils";
import { Timeline, type TimelineData } from "@/components/timeline/timeline";

const API_BASE = import.meta.env.VITE_API_URL || "";

export default function SequenceTimeline() {
  const [, params] = useRoute("/sequence/:id");
  const sequenceId = params?.id ?? "";

  const [data, setData] = useState<TimelineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    if (!sequenceId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}`);
      if (!resp.ok) {
        throw new Error(
          resp.status === 404
            ? "That sequence does not exist."
            : `The sequence could not be loaded (${resp.status}).`,
        );
      }
      setData(await resp.json());
    } catch (err) {
      // Stated rather than rendered as emptiness. Doc 17 found every one of the
      // five old pages showing an API failure as "no data".
      setError(err instanceof Error ? err.message : "The sequence could not be loaded.");
    }
    setLoading(false);
  }, [sequenceId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1200px] flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex shrink-0 flex-col gap-1 sm:mb-6">
        <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-dim">Sequence</span>
        <h1 className="text-xl font-bold text-foreground sm:text-3xl">Timeline</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Clips, levels, and where the music steps back for the voice.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pb-12">
        {loading && !data && <p className="text-[12px] text-dim">Loading the sequence…</p>}

        {error && (
          <p className="rounded-sm border border-destructive/50 bg-raised px-2.5 py-1.5 text-[12px] text-destructive">
            {error}
          </p>
        )}

        {data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground">
                {data.clips.length} clip{data.clips.length === 1 ? "" : "s"}
              </span>
              <span
                className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground"
                data-numeric
              >
                {(data.totalDurationMs / 1000).toFixed(1)}s total
              </span>
              <span className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground">
                {data.tracks.length} track{data.tracks.length === 1 ? "" : "s"}
              </span>
            </div>

            <Timeline
              data={data}
              onReorder={async (order) => {
                setError(null);
                try {
                  const resp = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}/clips/order`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ order }),
                  });
                  if (!resp.ok) {
                    const body = await resp.json().catch(() => ({}));
                    throw new Error(body.error ?? "The clips could not be reordered.");
                  }
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "The clips could not be reordered.");
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
