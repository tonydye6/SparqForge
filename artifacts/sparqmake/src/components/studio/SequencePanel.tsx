import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

import { apiFetch, cn } from "@/lib/utils";
import { Timeline, type TimelineData } from "@/components/timeline/timeline";
import type { StageTake } from "@/components/studio/RefineDeck";

const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * Stage 03 · Media · Sequence — build step 1 of the sequencing plan
 * (doc 42 third addendum; Tony picked 1A + 2B).
 *
 * The third medium tab: the Phase 9 timeline, finally inside the stage it was
 * built for, with the Add-a-shot hub in front of it. Three sources today —
 * ANIMATE A TAKE (any of this stage's stills, through the same locked video
 * path the Motion tab uses), the post's existing clips, and the brand's
 * library footage (policy-filtered, refusals counted). Upload arrives with a
 * later step.
 *
 * The timeline itself is the Phase 9 component untouched: lanes, blocks,
 * scheduled duck windows, the mixer's warnings in its own words. This panel
 * only feeds it and adds shots.
 */

interface Candidate {
  sourceKind: "generated" | "library_asset" | "studio_take";
  id: string;
  name: string;
  durationMs: number | null;
  thumbnailUrl: string | null;
}

interface Candidates {
  generated: Candidate[];
  studio: Candidate[];
  library: Candidate[];
  hidden: { count: number; reasons: Array<{ reason: string; count: number }> };
  uploadNote: string;
}

type HubSource = "animate" | "clips" | "library";

interface Voice {
  voiceId: string;
  name: string;
  description: string | null;
  previewUrl: string | null;
}

export function SequencePanel({
  creativeId,
  stageId,
  /** For the narrator: the voice is a brand-record field. */
  brandId,
  /** Every take on this stage — the stills the Animate source offers. */
  takes,
  locked,
  onChanged,
  /** The stage shell's forward, so a rendered cut is not a dead end. */
  onContinue,
}: {
  creativeId: string;
  stageId: string;
  brandId: string | null;
  takes: StageTake[];
  locked: boolean;
  onChanged: () => void;
  onContinue?: () => void;
}) {
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [checkedForSequence, setCheckedForSequence] = useState(false);
  const [data, setData] = useState<TimelineData | null>(null);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  const [source, setSource] = useState<HubSource | null>(null);
  const [busy, setBusy] = useState(false);
  /** The slot currently being animated, so its tile can say so. */
  const [animating, setAnimating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Step 2: the sound rack. The narrator is a brand-record field — the voice
   * is part of the brand contract (doc 24 §3), so choosing one writes
   * narratorVoiceId through the same PATCH the record screen uses.
   */
  const [narratorVoiceId, setNarratorVoiceId] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [pickingVoice, setPickingVoice] = useState(false);
  const [soundBusy, setSoundBusy] = useState<"voice" | "music" | "sfx" | null>(null);
  const [musicPrompt, setMusicPrompt] = useState("");
  const [voiceScript, setVoiceScript] = useState("");
  const [sfxPrompt, setSfxPrompt] = useState("");
  const [sfxAt, setSfxAt] = useState("0");
  const [soundNote, setSoundNote] = useState<string | null>(null);

  /* Step 3: the render. What it did NOT do is kept beside what it produced. */
  const [rendering, setRendering] = useState(false);
  const [renderWarnings, setRenderWarnings] = useState<string[]>([]);

  /*
   * The narrator comes from the BRAND RECORD, which is where the picker writes
   * it. Found by walking step 3: `GET /brands/:id` runs its row through a
   * response schema that has no `narratorVoiceId`, so the field was silently
   * dropped and the rack said "No narrator on the brand record" about a brand
   * that had one saved — which also hid the Read-the-hook buttons entirely
   * after any reload. Reading from the same endpoint the PATCH writes to means
   * the two can no longer disagree.
   */
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/brands/${brandId}/record`);
        if (!res.ok || cancelled) return;
        const body = await res.json() as { brand?: { narratorVoiceId?: string | null } };
        if (!cancelled) setNarratorVoiceId(body.brand?.narratorVoiceId ?? null);
      } catch { /* the rack shows "choose a narrator" either way */ }
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  async function openVoicePicker() {
    setPickingVoice(true);
    if (voices) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/voices`);
      const body = (await res.json().catch(() => null)) as { voices?: Voice[]; error?: string } | null;
      if (!res.ok) { setError(body?.error ?? "The voice list could not be read."); return; }
      setVoices(body?.voices ?? []);
    } catch {
      setError("The voice list could not be reached.");
    }
  }

  async function chooseNarrator(v: Voice) {
    if (!brandId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/brands/${brandId}/record`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { narratorVoiceId: v.voiceId }, source: "user" }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(b?.error ?? "The narrator could not be saved.");
        return;
      }
      setNarratorVoiceId(v.voiceId);
      setPickingVoice(false);
    } finally {
      setBusy(false);
    }
  }

  async function generateSound(kind: "voice" | "music" | "sfx", body: Record<string, unknown>) {
    if (!sequenceId || soundBusy || locked) return;
    setSoundBusy(kind);
    setError(null);
    setSoundNote(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => null)) as { error?: string; costUsd?: number } | null;
      if (!res.ok) {
        setError(out?.error ?? "That could not be generated.");
        return;
      }
      if (typeof out?.costUsd === "number") setSoundNote(`Generated · $${out.costUsd.toFixed(2)}`);
      await loadTimeline();
    } catch {
      setError("That could not be reached. Nothing was charged.");
    } finally {
      setSoundBusy(null);
    }
  }

  // Whether this post already has a sequence. One row per post for now — the
  // list endpoint exists so this never mints duplicates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { sequences?: Array<{ id: string }> };
        if (!cancelled) setSequenceId(body.sequences?.[0]?.id ?? null);
      } catch {
        // The panel offers Start below; a failed read reads as "none yet".
      } finally {
        if (!cancelled) setCheckedForSequence(true);
      }
    })();
    return () => { cancelled = true; };
  }, [creativeId]);

  const loadTimeline = useCallback(async () => {
    if (!sequenceId) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}`);
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as TimelineData);
    } catch {
      setError("The sequence could not be loaded.");
    }
  }, [sequenceId]);

  useEffect(() => { void loadTimeline(); }, [loadTimeline]);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/clip-candidates`);
      if (!res.ok) return;
      setCandidates((await res.json()) as Candidates);
    } catch {
      // The hub's lists render empty rather than blocking the timeline.
    }
  }, [creativeId]);

  useEffect(() => {
    if (source === "clips" || source === "library") void loadCandidates();
  }, [source, loadCandidates]);

  async function startSequence() {
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/sequences`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { sequence?: { id: string }; error?: string } | null;
      if (!res.ok || !body?.sequence?.id) {
        setError(body?.error ?? "The sequence could not be started.");
        return;
      }
      setSequenceId(body.sequence.id);
    } catch {
      setError("The sequence could not be started.");
    } finally {
      setBusy(false);
    }
  }

  /** Animate a still into a new shot — the same priced, locked path as Motion. */
  async function animateTake(slotKey: string) {
    if (!sequenceId || animating || locked) return;
    setAnimating(slotKey);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/creatives/${creativeId}/stages/${stageId}/motion-convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotKey, sequenceId }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "The shot could not be made.");
        return;
      }
      await loadTimeline();
      onChanged();
    } catch {
      setError("The shot could not be reached. Nothing was charged.");
    } finally {
      setAnimating(null);
    }
  }

  /**
   * Render the cut.
   *
   * Free — it is ffmpeg on the machine already running, not a vendor call — so
   * there is no price to show and no confirmation to sit through. What it
   * could not do comes back as warnings and stays on screen beside the result.
   */
  async function renderCut() {
    if (!sequenceId || rendering || locked) return;
    setRendering(true);
    setError(null);
    setRenderWarnings([]);
    try {
      const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}/render`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; warnings?: string[] }
        | null;
      if (!res.ok) {
        setError(body?.error ?? "The cut could not be rendered.");
        return;
      }
      setRenderWarnings(body?.warnings ?? []);
      await loadTimeline();
      // The cut takes the motion slot's place, so the stage's takes changed.
      onChanged();
    } catch {
      setError("The render could not be reached. Nothing was published.");
    } finally {
      setRendering(false);
    }
  }

  /** Add an already-existing clip or a library video as a shot. */
  async function addCandidate(c: Candidate) {
    if (!sequenceId || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          c.sourceKind === "studio_take"
            ? { sourceKind: "studio_take", sourceTakeId: c.id, ...(c.durationMs ? { trimEndMs: c.durationMs } : {}) }
            : c.sourceKind === "generated"
              ? { sourceKind: "generated", sourceVariantId: c.id }
              : { sourceKind: "library_asset", sourceAssetId: c.id },
        ),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? "That shot could not be added.");
        return;
      }
      await loadTimeline();
    } catch {
      setError("That shot could not be added.");
    } finally {
      setBusy(false);
    }
  }

  /** This stage's stills, newest slots last, each one a possible shot. */
  const stills = takes.filter((t) => {
    const p = t.payload as { imageUrl?: unknown } | undefined;
    return t.isCurrent && typeof p?.imageUrl === "string";
  });

  const thumbOf = (t: StageTake) => (t.payload as { imageUrl?: string }).imageUrl ?? "";

  if (!checkedForSequence) {
    return <div className="mx-auto max-w-5xl p-6"><p className="text-[12px] text-dim">Reading the sequence…</p></div>;
  }

  if (!sequenceId) {
    return (
      <div className="mx-auto max-w-5xl space-y-3 p-6">
        <p className="ui-label text-grit-teal">
          Stage 03 · Sequence
        </p>
        <h2 className="font-display text-xl tracking-wide text-foreground">Several shots, one post</h2>
        <button
          onClick={() => void startSequence()}
          disabled={busy || locked}
          className="flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover-elevate disabled:opacity-40"
          data-testid="button-start-sequence"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <>Start a sequence <ArrowRight size={9} /></>}
        </button>
        {error && <p className="text-[11.5px] text-rebel-pink">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex items-start gap-3">
        <div className="space-y-1">
          <p className="ui-label text-grit-teal">
            Stage 03 · Sequence
          </p>
          <h2 className="font-display text-xl tracking-wide text-foreground">The cut</h2>
        </div>
      </div>

      {error && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-rebel-pink">
          {error}
        </p>
      )}

      {data && (
        <Timeline
          data={data}
          onReorder={async (order) => {
            setError(null);
            const res = await apiFetch(`${API_BASE}/api/sequences/${sequenceId}/clips/order`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ order }),
            }).catch(() => null);
            if (!res?.ok) setError("The shots could not be reordered.");
            await loadTimeline();
          }}
        />
      )}

      {/* The Add-a-shot hub. Three sources; upload arrives with a later step. */}
      {!locked && (
        <div className="rounded-sm border border-border bg-card px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="ui-label text-grit-teal">Add a shot</span>
            {([
              ["animate", "Animate a take"],
              ["clips", "Existing clips"],
              ["library", "Library footage"],
            ] as Array<[HubSource, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSource((s) => (s === key ? null : key))}
                aria-pressed={source === key}
                className={cn(
                  "rounded-sm border px-2 py-1 text-[12px] font-medium hover-elevate",
                  source === key ? "border-grit-teal bg-grit-teal/10 text-cyber-teal" : "border-border text-muted-foreground",
                )}
                data-testid={`button-shot-source-${key}`}
              >
                {label}
              </button>
            ))}
            <div className="flex-1" />
            {source === "animate" && (
              <span className="ui-label text-dim">
                billed per second of clip {"·"} the shot lands at the end of the cut
              </span>
            )}
          </div>

          {source === "animate" && (
            <div className="mt-2 flex flex-wrap gap-2">
              {stills.length === 0 && (
                <p className="text-[11px] text-dim">No stills on this stage yet. Run the spread on the Image tab first.</p>
              )}
              {stills.map((t) => (
                <button
                  key={t.id}
                  onClick={() => void animateTake(t.slotKey)}
                  disabled={animating !== null}
                  title={t.slotKey}
                  className={cn(
                    "relative h-16 w-16 overflow-hidden rounded-sm border hover-elevate disabled:opacity-50",
                    animating === t.slotKey ? "border-grit-teal" : "border-border",
                  )}
                  data-testid={`button-animate-${t.slotKey}`}
                >
                  <img src={thumbOf(t)} alt="" className="h-full w-full object-cover" />
                  {animating === t.slotKey && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 size={14} className="animate-spin text-cyber-teal" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {(source === "clips" || source === "library") && (
            <div className="mt-2 space-y-1.5">
              {(source === "clips"
                ? [...(candidates?.studio ?? []), ...(candidates?.generated ?? [])]
                : candidates?.library ?? []
              ).map((c) => (
                <button
                  key={`${c.sourceKind}:${c.id}`}
                  onClick={() => void addCandidate(c)}
                  disabled={busy}
                  className="flex w-full items-center gap-2.5 rounded-sm border border-border px-2 py-1.5 text-left hover-elevate disabled:opacity-50"
                  data-testid={`button-add-candidate-${c.id}`}
                >
                  {c.thumbnailUrl ? (
                    <img src={c.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded-sm object-cover" />
                  ) : (
                    <span className="h-9 w-9 shrink-0 rounded-sm border border-border/60" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">{c.name}</span>
                  <span className="shrink-0 ui-label text-dim">
                    {c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : "length unknown"}
                  </span>
                </button>
              ))}
              {source === "clips" && (candidates?.studio ?? []).length + (candidates?.generated ?? []).length === 0 && (
                <p className="text-[11px] text-dim">No clips on this post yet. Animate a take, or the pick on the Motion tab.</p>
              )}
              {source === "library" && (candidates?.library ?? []).length === 0 && (
                <p className="text-[11px] text-dim">No usable video in this brand's library.</p>
              )}
              {source === "library" && candidates && candidates.hidden.count > 0 && (
                <p className="text-[10.5px] leading-relaxed text-victory-gold">
                  {candidates.hidden.count} hidden by policy: {candidates.hidden.reasons.map((r) => `${r.count} — ${r.reason.toLowerCase()}`).join("; ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/*
        The sound rack (build step 2): voice, music, SFX generated INTO tracks.
        Each row is one line — what it is, where it comes from, one priced
        action — and the result lands on the lanes above, duck span included.
      */}
      {!locked && (
        <div className="rounded-sm border border-border bg-card px-3 py-2.5" data-testid="sound-rack">
          <div className="flex items-center gap-2">
            <span className="ui-label text-grit-teal">Sound</span>
            {soundNote && <span className="ui-label text-cyber-teal">{soundNote}</span>}
          </div>

          {/* Voice */}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            <span className="ui-label text-victory-gold">Voice</span>
            {narratorVoiceId ? (
              <>
                <span className="text-[11px] text-muted-foreground">Reads in the brand's narrator</span>
                <div className="flex-1" />
                <button
                  onClick={() => void generateSound("voice", { source: "hook" })}
                  disabled={soundBusy !== null}
                  className="rounded-sm border border-grit-teal px-2 py-1 text-[12px] font-medium text-cyber-teal hover-elevate disabled:opacity-40"
                  data-testid="button-voice-hook"
                >
                  {soundBusy === "voice" ? <Loader2 size={9} className="animate-spin" /> : "Read the hook"}
                </button>
                <button
                  onClick={() => void generateSound("voice", { source: "base" })}
                  disabled={soundBusy !== null}
                  className="rounded-sm border border-border px-2 py-1 text-[12px] font-medium text-muted-foreground hover-elevate disabled:opacity-40"
                  data-testid="button-voice-base"
                >
                  Read the caption
                </button>
                <input
                  value={voiceScript}
                  onChange={(e) => setVoiceScript(e.target.value)}
                  placeholder="or type a script"
                  aria-label="Custom voiceover script"
                  className="w-44 rounded-sm border border-border bg-raised px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal"
                />
                <button
                  onClick={() => void generateSound("voice", { source: "custom", script: voiceScript })}
                  disabled={soundBusy !== null || !voiceScript.trim()}
                  className="rounded-sm border border-border px-2 py-1 text-[12px] font-medium text-muted-foreground hover-elevate disabled:opacity-40"
                  data-testid="button-voice-custom"
                >
                  Speak it
                </button>
              </>
            ) : (
              <>
                <span className="text-[11px] text-muted-foreground">No narrator on the brand record</span>
                <div className="flex-1" />
                <button
                  onClick={() => void openVoicePicker()}
                  className="rounded-sm border border-grit-teal px-2 py-1 text-[12px] font-medium text-cyber-teal hover-elevate"
                  data-testid="button-choose-narrator"
                >
                  Choose a narrator
                </button>
              </>
            )}
          </div>

          {/* The narrator picker: the account's voices, heard before chosen. */}
          {pickingVoice && !narratorVoiceId && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-sm border border-border/60 bg-raised p-2">
              {voices === null && <p className="text-[11px] text-dim">Reading the account's voices…</p>}
              {voices?.map((v) => (
                <div key={v.voiceId} className="flex items-center gap-2 border-b border-border/40 pb-1 last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground" title={v.description ?? undefined}>
                    {v.name}
                  </span>
                  {v.previewUrl && (
                    <button
                      onClick={() => { new Audio(v.previewUrl!).play().catch(() => undefined); }}
                      className="rounded-sm border border-border px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground hover-elevate"
                    >
                      Hear it
                    </button>
                  )}
                  <button
                    onClick={() => void chooseNarrator(v)}
                    disabled={busy}
                    className="rounded-sm border border-grit-teal px-1.5 py-0.5 text-[12px] font-medium text-cyber-teal hover-elevate disabled:opacity-40"
                    data-testid={`button-narrator-${v.voiceId}`}
                  >
                    This one
                  </button>
                </div>
              ))}
              {voices?.length === 0 && <p className="text-[11px] text-dim">The account has no voices.</p>}
            </div>
          )}

          {/* Music */}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            <span className="ui-label text-dim">Music</span>
            <input
              value={musicPrompt}
              onChange={(e) => setMusicPrompt(e.target.value)}
              placeholder="empty = the brand's sound direction"
              aria-label="What the music should be"
              className="w-56 rounded-sm border border-border bg-raised px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal"
            />
            <div className="flex-1" />
            <span className="ui-label text-dim">scored at the cut's length {"·"} steps back under the voice</span>
            <button
              onClick={() => void generateSound("music", musicPrompt.trim() ? { prompt: musicPrompt.trim() } : {})}
              disabled={soundBusy !== null}
              className="rounded-sm border border-grit-teal px-2 py-1 text-[12px] font-medium text-cyber-teal hover-elevate disabled:opacity-40"
              data-testid="button-score-cut"
            >
              {soundBusy === "music" ? <Loader2 size={9} className="animate-spin" /> : "Score the cut"}
            </button>
          </div>

          {/* SFX */}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            <span className="ui-label text-dim">SFX</span>
            <input
              value={sfxPrompt}
              onChange={(e) => setSfxPrompt(e.target.value)}
              placeholder="starting gun, crowd swell…"
              aria-label="What the effect is"
              className="w-44 rounded-sm border border-border bg-raised px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-dim focus:border-grit-teal"
            />
            <span className="ui-label text-dim">at</span>
            <input
              value={sfxAt}
              onChange={(e) => setSfxAt(e.target.value)}
              inputMode="decimal"
              aria-label="Seconds into the cut"
              className="w-12 rounded-sm border border-border bg-raised px-2 py-1 text-right text-[11px] text-foreground outline-none focus:border-grit-teal"
            />
            <span className="ui-label text-dim">s</span>
            <div className="flex-1" />
            <button
              onClick={() => {
                const at = Math.max(0, Math.round((Number.parseFloat(sfxAt) || 0) * 1000));
                void generateSound("sfx", { prompt: sfxPrompt.trim(), atMs: at });
              }}
              disabled={soundBusy !== null || !sfxPrompt.trim()}
              className="rounded-sm border border-grit-teal px-2 py-1 text-[12px] font-medium text-cyber-teal hover-elevate disabled:opacity-40"
              data-testid="button-add-sfx"
            >
              {soundBusy === "sfx" ? <Loader2 size={9} className="animate-spin" /> : "Add the hit"}
            </button>
          </div>
        </div>
      )}

      {/*
        The exit (build step 3). One line saying what the cut IS and where it
        stands, one action, and — once it has rendered — the file itself, so
        nobody has to publish to find out what they made. Every word of the
        line comes from the server's own status, so the bar cannot claim a
        state the render endpoint would refuse.
      */}
      {data?.cut && (
        <div className="rounded-sm border border-border bg-card px-3 py-2.5" data-testid="cut-bar">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={cn(
                "size-[7px] shrink-0 rounded-full",
                data.cut.state === "rendered" ? "bg-cyber-teal"
                  : data.cut.state === "failed" ? "bg-rebel-pink"
                  : data.cut.state === "empty" ? "bg-dim"
                  : "bg-victory-gold",
              )}
            />
            <span className="text-[12px] text-foreground" data-testid="text-cut-summary">
              {data.cut.summary}
            </span>
            <div className="flex-1" />

            {data.cut.state === "rendered" && onContinue && (
              <button
                onClick={onContinue}
                className="flex items-center gap-1.5 rounded-sm bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover-elevate"
                data-testid="button-cut-continue"
              >
                Continue {"·"} 04 Copy <ArrowRight size={9} />
              </button>
            )}

            {!locked && data.cut.state !== "empty" && (
              <button
                onClick={() => void renderCut()}
                disabled={rendering || data.cut.blocked !== null}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-[12px] font-medium hover-elevate disabled:opacity-40",
                  data.cut.state === "rendered"
                    ? "border border-border text-muted-foreground"
                    : "bg-primary text-primary-foreground",
                )}
                data-testid="button-render-cut"
              >
                {rendering ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : data.cut.state === "rendered" ? (
                  <>Render again {"·"} free</>
                ) : data.cut.state === "stale" ? (
                  <>Render it again {"·"} free</>
                ) : data.cut.state === "failed" ? (
                  <>Try again {"·"} free</>
                ) : (
                  <>Render the cut {"·"} free</>
                )}
              </button>
            )}
          </div>

          {data.cut.blocked && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-rebel-pink">{data.cut.blocked}</p>
          )}

          {data.cut.renderedUrl && (
            <div className="mt-2">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                controls
                src={data.cut.renderedUrl}
                className="max-h-[360px] rounded-sm border border-border bg-background"
                data-testid="video-rendered-cut"
              />
            </div>
          )}

          {renderWarnings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {renderWarnings.map((w, i) => (
                <li key={i} className="text-[11px] leading-relaxed text-victory-gold">{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
