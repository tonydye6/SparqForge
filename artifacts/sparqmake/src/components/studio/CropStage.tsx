import { useEffect, useMemo, useState } from "react";
import { apiFetch, cn } from "@/lib/utils";

/**
 * Stage 05 · Channel crops. NOT resizing.
 *
 * Every platform covers part of your picture with its own interface. A resize
 * that only changes aspect ratio hands you an image whose subject is sitting
 * under a comment button, and you find out after publishing. So each channel is
 * drawn here WITH its real furniture over the top, reframed around a focal point
 * you can move, and anything colliding is flagged before it ships rather than
 * after.
 *
 * One focal point drives all four frames, so nudging is one gesture rather than
 * four. This is also where the Pipeline's ×N badge comes from: one creative, N
 * channel outputs.
 */

interface CropStageProps {
  creativeId: string;
  stageId: string;
  locked: boolean;
  selectedImageUrl: string | null;
  hook: string | null;
  onSaved: () => void;
}

interface SafeArea { edge: "top" | "bottom" | "left" | "right"; fraction: number; what: string }
interface Target { platform: string; label: string; aspect: number; aspectLabel: string; safeAreas: SafeArea[] }
interface Focal { x: number; y: number }

/** Mirrors CROP_TARGETS on the server. */
const TARGETS: Target[] = [
  { platform: "instagram_feed", label: "Instagram feed", aspect: 4 / 5, aspectLabel: "4:5", safeAreas: [] },
  {
    platform: "instagram_story", label: "Instagram story", aspect: 9 / 16, aspectLabel: "9:16",
    safeAreas: [
      { edge: "top", fraction: 0.14, what: "the profile row and close button" },
      { edge: "bottom", fraction: 0.2, what: "the reply bar" },
    ],
  },
  {
    platform: "tiktok", label: "TikTok", aspect: 9 / 16, aspectLabel: "9:16",
    safeAreas: [
      { edge: "right", fraction: 0.17, what: "the action rail" },
      { edge: "bottom", fraction: 0.24, what: "the caption block and username" },
      { edge: "top", fraction: 0.09, what: "the following/for-you tabs" },
    ],
  },
  { platform: "twitter", label: "X", aspect: 16 / 9, aspectLabel: "16:9", safeAreas: [] },
];

const DEFAULT_FOCAL: Focal = { x: 0.5, y: 0.42 };
const HOOK_ANCHOR: Focal = { x: 0.5, y: 0.9 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function cropRect(sourceAspect: number, targetAspect: number, focal: Focal) {
  let width = 1, height = 1;
  if (targetAspect < sourceAspect) width = targetAspect / sourceAspect;
  else if (targetAspect > sourceAspect) height = sourceAspect / targetAspect;
  const x = clamp01(clamp01(focal.x) - width / 2);
  const y = clamp01(clamp01(focal.y) - height / 2);
  return { x: Math.min(x, 1 - width), y: Math.min(y, 1 - height), width, height };
}

const inFrame = (p: Focal, r: ReturnType<typeof cropRect>): Focal =>
  ({ x: (p.x - r.x) / r.width, y: (p.y - r.y) / r.height });

function underSafe(p: Focal, a: SafeArea): boolean {
  if (a.edge === "top") return p.y < a.fraction;
  if (a.edge === "bottom") return p.y > 1 - a.fraction;
  if (a.edge === "left") return p.x < a.fraction;
  return p.x > 1 - a.fraction;
}

export function CropStage({ creativeId, stageId, locked, selectedImageUrl, hook, onSaved }: CropStageProps) {
  const [focal, setFocal] = useState<Focal>(DEFAULT_FOCAL);
  const [sourceAspect, setSourceAspect] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Restore the saved framing, so reopening does not silently re-centre a crop
  // someone deliberately nudged.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/creatives/${creativeId}/stages`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const crops = (body?.stages ?? []).find((s: { stageKind: string }) => s.stageKind === "crops");
        if (!crops) return;
        const cur = (body?.takes?.[crops.id] ?? []).find(
          (t: { slotKey: string; isCurrent: boolean }) => t.slotKey === "crops" && t.isCurrent,
        );
        const f = cur?.payload?.focal;
        if (f && typeof f.x === "number" && typeof f.y === "number" && !cancelled) {
          setFocal({ x: f.x, y: f.y });
          setSaved(true);
        }
      } catch { /* fall back to the default framing */ }
    })();
    return () => { cancelled = true; };
  }, [creativeId, stageId]);

  const plans = useMemo(
    () =>
      TARGETS.map((target) => {
        const rect = cropRect(sourceAspect, target.aspect, focal);
        const framedFocal = inFrame(focal, rect);
        const warnings: string[] = [];
        for (const a of target.safeAreas) {
          if (underSafe(framedFocal, a)) warnings.push(`The subject falls under ${a.what}. Nudge it clear, or accept and lose it.`);
        }
        if (hook?.trim()) {
          for (const a of target.safeAreas) {
            if (underSafe(HOOK_ANCHOR, a)) warnings.push(`The hook sits under ${a.what}. It will reflow higher for this channel.`);
          }
        }
        return { target, rect, warnings };
      }),
    [focal, sourceAspect, hook],
  );

  const totalWarnings = plans.reduce((n, p) => n + p.warnings.length, 0);

  async function save() {
    if (locked || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/takes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotKey: "crops",
          origin: "user_typed",
          payload: {
            focal,
            crops: plans.map((p) => ({ platform: p.target.platform, rect: p.rect, warnings: p.warnings })),
          },
          consumedFrom: [],
        }),
      });
      if (res.ok) { setSaved(true); onSaved(); }
    } finally {
      setSaving(false);
    }
  }

  if (!selectedImageUrl) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <p className="max-w-[70ch] text-[12.5px] leading-relaxed text-muted-foreground">
          There is nothing to crop yet. Open stage 03, pick a take and choose{" "}
          <span className="text-foreground">Use this take</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="rounded-sm border border-border/60 bg-card px-3.5 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-grit-teal">Framing</p>
        <p className="mt-1 max-w-[80ch] text-[12px] leading-relaxed text-muted-foreground">
          This is not resizing. Each channel draws its own interface over your picture, so the frame
          moves to keep the subject clear of it. One point drives all four.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[10.5px] text-dim">
            Across
            <input
              type="range" min={0} max={1} step={0.01} value={focal.x} disabled={locked}
              onChange={(e) => { setFocal((f) => ({ ...f, x: Number(e.target.value) })); setSaved(false); }}
              className="w-40" aria-label="Focal point across"
            />
            <span data-numeric className="font-mono">{Math.round(focal.x * 100)}%</span>
          </label>
          <label className="flex items-center gap-2 text-[10.5px] text-dim">
            Down
            <input
              type="range" min={0} max={1} step={0.01} value={focal.y} disabled={locked}
              onChange={(e) => { setFocal((f) => ({ ...f, y: Number(e.target.value) })); setSaved(false); }}
              className="w-40" aria-label="Focal point down"
            />
            <span data-numeric className="font-mono">{Math.round(focal.y * 100)}%</span>
          </label>
          <button
            type="button" disabled={locked}
            onClick={() => { setFocal(DEFAULT_FOCAL); setSaved(false); }}
            className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate"
          >
            Reset
          </button>
          <span className={cn("ml-auto font-mono text-[9.5px] uppercase tracking-[0.09em]", totalWarnings > 0 ? "text-victory-gold" : "text-dim")}>
            {totalWarnings === 0 ? "Nothing covered" : `${totalWarnings} to look at`}
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map(({ target, rect, warnings }) => (
          <div key={target.platform} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">{target.label}</p>
              <span className="font-mono text-[9px] text-dim">{target.aspectLabel}</span>
            </div>

            {/* The frame, with the platform's furniture drawn over it. */}
            <div
              className={cn(
                "relative w-full overflow-hidden rounded-sm border",
                warnings.length > 0 ? "border-victory-gold/50" : "border-border/60",
              )}
              style={{ aspectRatio: String(target.aspect) }}
            >
              <img
                src={selectedImageUrl}
                alt={`${target.label} crop`}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) setSourceAspect(el.naturalWidth / el.naturalHeight);
                }}
                className="absolute max-w-none"
                style={{
                  width: `${(1 / rect.width) * 100}%`,
                  height: `${(1 / rect.height) * 100}%`,
                  left: `${(-rect.x / rect.width) * 100}%`,
                  top: `${(-rect.y / rect.height) * 100}%`,
                }}
              />

              {/*
                Real chrome, drawn to scale. Hatched rather than solid so the
                picture underneath stays judgeable: the point is to see what is
                covered, not to hide it.
              */}
              {target.safeAreas.map((a) => (
                <div
                  key={`${a.edge}-${a.fraction}`}
                  title={a.what}
                  className="pointer-events-none absolute bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.55)_0px,rgba(0,0,0,0.55)_4px,transparent_4px,transparent_8px)]"
                  style={
                    a.edge === "top" ? { top: 0, left: 0, right: 0, height: `${a.fraction * 100}%` }
                    : a.edge === "bottom" ? { bottom: 0, left: 0, right: 0, height: `${a.fraction * 100}%` }
                    : a.edge === "left" ? { top: 0, bottom: 0, left: 0, width: `${a.fraction * 100}%` }
                    : { top: 0, bottom: 0, right: 0, width: `${a.fraction * 100}%` }
                  }
                />
              ))}

              {/* Where the subject actually is, so the nudge has something to aim. */}
              <span
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-grit-teal bg-grit-teal/30"
                style={{ left: `${inFrame(focal, rect).x * 100}%`, top: `${inFrame(focal, rect).y * 100}%` }}
              />

              {hook?.trim() && (
                <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 font-display text-[9px] uppercase leading-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                  {hook}
                </span>
              )}
            </div>

            {warnings.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-dim">Nothing of yours is covered here.</p>
            ) : (
              <ul className="space-y-0.5">
                {warnings.map((w) => (
                  <li key={w} className="text-[10px] leading-relaxed text-victory-gold">{w}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-sm border border-border/60 bg-card px-3.5 py-3">
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Warnings never block. You may well decide the mark can sit under TikTok's caption block;
          what you should not do is find out afterwards.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {saved && <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-dim">Saved</span>}
          <button
            type="button" onClick={() => void save()} disabled={locked || saving}
            className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
          >
            {saving ? "Saving" : "Save the framing"}
          </button>
        </div>
      </div>
    </div>
  );
}
