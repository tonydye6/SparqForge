import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2, Play } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { useCanWrite } from "@/hooks/useAuth";
import { InfoDot } from "./InfoDot";

/**
 * Phase 10 · saved runs and cross-brand fan-out, on the Studio v2 surface.
 *
 * Doc 22 Phase 10 items 2 and 3. Two controls, both deliberately here rather
 * than on a page of their own:
 *
 *   SaveRunButton   · in the shell, beside the stage that got locked.
 *   SavedRunsPanel  · on the picker, because a saved run is a way to START.
 *
 * That second placement fixes something the picker was missing on its own: it
 * could only ever open work that already existed, so there was no way into the
 * v2 Studio from nothing. A saved run is the way in.
 *
 * THE RULE THIS UI EXISTS TO KEEP. Running is free and never generates, so the
 * consequence is shown BEFORE the act, exactly like the reopen bar on the
 * spine. The panel does not say "2 posts will be made"; it says which stages
 * carry into which brand and which do not, in the words the server used. Doc 24
 * §8: does this make the collaboration more visible, or less.
 */

interface RunBrand {
  id: string;
  name: string;
}

interface RunRow {
  id: string;
  name: string;
  lockedStages: number[];
  runCount: number;
  lastRunAt: string | null;
  brands: RunBrand[];
  replayable: boolean;
  blockedReason: string | null;
}

interface ReplayNote {
  kind: "rederived" | "dropped" | "carried" | "voice";
  slotKey: string;
  text: string;
}

interface Preview {
  brandId: string;
  brandName: string;
  crossBrand: boolean;
  willCarry: Array<{ stageNumber: number; stageKind: string; locked: boolean }>;
  notes: ReplayNote[];
}

const STAGE_LABELS: Record<string, string> = {
  brief: "Spark",
  direction: "Director",
  asset: "Media",
  copy: "Copy",
  crops: "Launch pad",
};

/** The five stages, so "what did not carry" can be drawn as absence. */
const ALL_STAGES: Array<{ number: number; kind: string }> = [
  { number: 1, kind: "brief" },
  { number: 2, kind: "direction" },
  { number: 3, kind: "asset" },
  { number: 4, kind: "copy" },
  { number: 5, kind: "crops" },
];

function noteTone(kind: ReplayNote["kind"]): string {
  // Pink is the only warning hue (Principle 1.6), and only the two notes that
  // are genuinely about a risk get it. Re-derivation is normal and correct, so
  // colouring it as a warning would teach people to ignore the colour.
  return kind === "voice" || kind === "carried" ? "text-rebel-pink" : "text-muted-foreground";
}

// ── Saving a run off a creative ──────────────────────────────────────────────

export function SaveRunButton({
  creativeId,
  brandId,
  stages,
  onSaved,
}: {
  creativeId: string;
  brandId: string | null;
  /** The live spine, so the panel can say what will travel before it is saved. */
  stages: Array<{ stageNumber: number; stageKind: string; status: string }>;
  onSaved?: () => void;
}) {
  const canWrite = useCanWrite();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [brands, setBrands] = useState<RunBrand[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    void apiFetch("/api/brands")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setBrands((Array.isArray(d) ? d : (d?.data ?? [])).map((b: RunBrand) => ({ id: b.id, name: b.name }))))
      .catch(() => setBrands([]));
  }, [open]);

  // The same rule the server applies, so the panel cannot promise something the
  // capture would then refuse: the brief always travels, later stages only if
  // they were locked.
  const travelling = stages.filter((s) => s.stageNumber === 1 || s.status === "locked");
  const briefPresent = stages.some((s) => s.stageNumber === 1);

  async function save() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/saved-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), brandIds: extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The run could not be saved.");
        return;
      }
      setDone(true);
      onSaved?.();
    } catch {
      setError("The run could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!canWrite) return null;

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((v) => !v); setDone(false); }}
        className="flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 text-[12px] font-medium text-muted-foreground hover-elevate"
        data-testid="button-save-run"
      >
        Save this run
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-30 w-[320px] rounded-sm border border-border bg-card p-3 shadow-lg">
          {done ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-foreground">Saved. It is on the Studio home, ready to run again.</p>
              <button
                onClick={() => setOpen(false)}
                className="rounded-sm border border-border px-2 py-1 text-[12px] font-medium text-muted-foreground hover-elevate"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 ui-label text-grit-teal">
                Save this run
                <InfoDot text="A saved run is the brief plus whichever stages you locked. Running it later writes them straight in and costs nothing." />
              </p>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name this run"
                className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none focus:border-grit-teal"
                data-testid="input-run-name"
              />

              <div className="space-y-1">
                <p className="ui-label text-dim">What travels</p>
                {briefPresent ? (
                  <p className="text-[12px] text-foreground">
                    {travelling.map((s) => STAGE_LABELS[s.stageKind] ?? s.stageKind).join(", ")}
                  </p>
                ) : (
                  <p className="text-[12px] text-rebel-pink">
                    The brief has nothing in it yet, so there is nothing to replay.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <p className="ui-label text-dim">Also run it for</p>
                <div className="flex flex-wrap gap-1">
                  {brands.filter((b) => b.id !== brandId).map((b) => {
                    const on = extra.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        onClick={() => setExtra((prev) => (on ? prev.filter((x) => x !== b.id) : [...prev, b.id]))}
                        className={cn(
                          "rounded-sm border px-2 py-1 text-[11.5px] hover-elevate",
                          on ? "border-grit-teal text-cyber-teal" : "border-border text-muted-foreground",
                        )}
                        data-testid={`chip-brand-${b.id}`}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && <p className="text-[12px] text-rebel-pink">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => void save()}
                  disabled={saving || !name.trim() || !briefPresent}
                  className="rounded-sm border border-grit-teal px-2.5 py-1 text-[12px] font-medium text-cyber-teal hover-elevate disabled:opacity-40"
                  data-testid="button-confirm-save-run"
                >
                  {saving ? <Loader2 size={10} className="animate-spin" /> : "Save"}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-sm border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover-elevate"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── The list, and running one ────────────────────────────────────────────────

function RunDetail({ runId, onOpenCreative }: { runId: string; onOpenCreative: (id: string) => void }) {
  const canWrite = useCanWrite();
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [running, setRunning] = useState(false);
  const [made, setMade] = useState<Array<{ brandName: string; creativeId: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch(`/api/saved-runs/${runId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPreviews(d?.previews ?? []))
      .catch(() => setPreviews([]));
  }, [runId]);

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/saved-runs/${runId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The run could not be started.");
        return;
      }
      setMade((body.results ?? []).map((r: { brandName: string; creativeId: string }) => ({
        brandName: r.brandName,
        creativeId: r.creativeId,
      })));
    } catch {
      setError("The run could not be started.");
    } finally {
      setRunning(false);
    }
  }

  if (previews === null) {
    return <p className="px-3 py-2 text-[12px] text-dim">Reading what this would carry...</p>;
  }

  return (
    <div className="space-y-2 border-t border-border/60 px-3 py-2.5">
      {previews.map((p) => (
        <div key={p.brandId} className="space-y-1.5" data-testid={`preview-${p.brandId}`}>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-foreground">{p.brandName}</span>
            {p.crossBrand && (
              <span className="ui-label text-dim">another brand</span>
            )}
          </div>

          {/* Absence drawn as absence: a stage that does not carry is still in
              the row, greyed, so it reads as "not this one" rather than as a
              shorter list nobody counts. Principle 4.4: never colour alone. */}
          <div className="flex flex-wrap gap-1">
            {ALL_STAGES.map((s) => {
              const carried = p.willCarry.some((w) => w.stageNumber === s.number);
              return (
                <span
                  key={s.number}
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 ui-label",
                    carried ? "border-grit-teal/60 text-cyber-teal" : "border-border/50 text-dim line-through",
                  )}
                >
                  {STAGE_LABELS[s.kind]}
                </span>
              );
            })}
          </div>

          {p.notes.map((n, i) => (
            <p key={i} className={cn("text-[11.5px] leading-relaxed", noteTone(n.kind))}>
              {n.text}
            </p>
          ))}
        </div>
      ))}

      {error && <p className="text-[12px] text-rebel-pink">{error}</p>}

      {made ? (
        <div className="space-y-1 pt-1">
          <p className="text-[12px] text-foreground">
            {made.length === 1 ? "One post made." : `${made.length} posts made.`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {made.map((m) => (
              <button
                key={m.creativeId}
                onClick={() => onOpenCreative(m.creativeId)}
                className="flex items-center gap-1 rounded-sm border border-grit-teal px-2 py-1 text-[12px] font-medium text-cyber-teal hover-elevate"
                data-testid={`button-open-made-${m.creativeId}`}
              >
                Open {m.brandName} <ChevronRight size={9} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        canWrite && (
          <button
            onClick={() => void run()}
            disabled={running || previews.length === 0}
            className="flex items-center gap-1.5 rounded-sm border border-grit-teal px-2.5 py-1 text-[12px] font-medium text-cyber-teal hover-elevate disabled:opacity-40"
            data-testid="button-run-saved-run"
          >
            {running ? <Loader2 size={10} className="animate-spin" /> : <Play size={9} />}
            {previews.length === 1 ? "Make the post" : `Make ${previews.length} posts`}
          </button>
        )
      )}
    </div>
  );
}

export function SavedRunsPanel({ onOpenCreative }: { onOpenCreative: (creativeId: string) => void }) {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    void apiFetch("/api/saved-runs")
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => setRuns([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (runs === null || runs.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="panel-saved-runs">
      <p className="flex items-center gap-1.5 ui-label text-grit-teal">
        Saved runs
        <InfoDot text="A brief plus whichever stages were locked, ready to run again. Running one writes those stages straight in, so it costs nothing. A run pointed at more than one brand makes one post per brand, each under its own contract." />
      </p>
      <div className="space-y-1.5 pt-1">
        {runs.map((run) => (
          <div key={run.id} className="rounded-sm border border-border/60 bg-card">
            <button
              onClick={() => setOpenId((prev) => (prev === run.id ? null : run.id))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover-elevate"
              data-testid={`button-open-run-${run.id}`}
            >
              <ChevronRight
                size={11}
                className={cn("shrink-0 text-dim transition-transform", openId === run.id && "rotate-90")}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{run.name}</span>
              <span className="ui-label text-dim">
                {run.brands.map((b) => b.name).join(" · ")}
              </span>
              <span className="ui-data text-[11px] tabular-nums text-dim">
                {run.runCount === 0 ? "never run" : `run ${run.runCount}`}
              </span>
            </button>
            {run.blockedReason && (
              <p className="px-3 pb-2 text-[11.5px] text-rebel-pink">{run.blockedReason}</p>
            )}
            {openId === run.id && run.replayable && (
              <RunDetail runId={run.id} onOpenCreative={onOpenCreative} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
