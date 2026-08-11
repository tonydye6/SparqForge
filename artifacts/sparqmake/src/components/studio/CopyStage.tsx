import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, cn } from "@/lib/utils";
import { useChannels } from "@/hooks/useChannels";
import { InfoDot } from "./InfoDot";

/**
 * Stage 04 · Copy.
 *
 * The decision this screen exists to express: TEXT ON THE IMAGE IS A LIVE
 * COMPOSITED LAYER, NOT GENERATED PIXELS. Rewriting the hook costs nothing and
 * never restales the image, which is what makes Copy a real stage instead of a
 * caption box, and what kills the most common reason people re-roll a picture
 * they were happy with.
 *
 * The interaction rule, from screen 12 and worth restating because it decides
 * the layout: the closer an artifact is to something you could make by hand, the
 * more the interface should let you make it by hand. Text is the closest thing
 * in this product, so DIRECT TYPING IS PRIMARY and drafting is the secondary,
 * offered path. There is deliberately no second chat panel here.
 *
 * Three details make direct editing safe rather than a trap:
 *   1. a hand-typed channel version is marked YOURS and is excluded from
 *      re-derives, so an upstream redraft cannot overwrite wording you chose
 *   2. derived versions are OFFERED a re-derive, never given one
 *   3. the voice check changes character with authorship: a constraint on the
 *      model, a note to you
 */

/*
 * The channel list used to live here, hardcoded, and stage 05 hardcoded a
 * different one while stage 01 read the brand's connected accounts. Three
 * surfaces, three answers, on the same post: this stage offered LinkedIn copy
 * to a brand with no LinkedIn account. It now asks, like everything else.
 */

interface CopyStageProps {
  creativeId: string;
  stageId: string;
  locked: boolean;
  /** The take stage 03 handed over, if it has. */
  selectedImageUrl: string | null;
  onSaved: () => void;
}

interface ChannelState {
  caption: string;
  hashtags: string;
  authored: boolean;
}

interface Rules {
  label: string;
  caption: number;
  hashtags: number;
}

const RULES: Record<string, Rules> = {
  instagram_feed: { label: "Instagram feed", caption: 2200, hashtags: 30 },
  twitter: { label: "X", caption: 280, hashtags: 3 },
  linkedin: { label: "LinkedIn", caption: 3000, hashtags: 5 },
  tiktok: { label: "TikTok", caption: 2200, hashtags: 5 },
};

const HOOK_BUDGET = 42;
const HOOK_REFLOW = 64;

const charCount = (s: string) => [...s].length;

function fitState(chars: number, limit: number): "ok" | "tight" | "over" {
  if (chars > limit) return "over";
  if (chars >= limit * 0.9) return "tight";
  return "ok";
}

const FIT_CLASS: Record<string, string> = {
  ok: "text-dim",
  tight: "text-victory-gold",
  over: "text-rebel-pink",
};

/** Mirrors voiceCheck on the server. Advisory here, because this text is yours. */
function voiceNotes(text: string, banned: string[]): string[] {
  const notes: string[] = [];
  const lower = text.toLowerCase();
  for (const term of banned) {
    const t = term.trim().toLowerCase();
    if (t && lower.includes(t)) notes.push(`"${term.trim()}" is on this brand's banned list.`);
  }
  const letters = [...text].filter((c) => /[a-z]/i.test(c));
  const caps = letters.filter((c) => c === c.toUpperCase());
  if (letters.length >= 12 && caps.length / letters.length > 0.6) {
    notes.push("Mostly capitals. Reads as shouting rather than confident.");
  }
  if (/#\w+/.test(text)) {
    notes.push("Hashtags are in the caption body. They have their own field below.");
  }
  return notes;
}

export function CopyStage({ creativeId, stageId, locked, selectedImageUrl, onSaved }: CopyStageProps) {
  const { channels: resolved, emptyReason } = useChannels(creativeId);
  const platformOrder = useMemo(() => (resolved ?? []).map((c) => c.platform), [resolved]);
  const [hook, setHook] = useState("");
  const [base, setBase] = useState("");
  const [channels, setChannels] = useState<Record<string, ChannelState>>({});
  const [banned, setBanned] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The base as it stood when the channels were last derived from it. */
  const [derivedFrom, setDerivedFrom] = useState("");
  /*
   * Draft-first (doc 41 item 9). A stage that opens as an empty caption box
   * with its actions at the bottom reads as "I don't even know where to
   * start" — Tony's words from walking it. When nothing has been saved yet,
   * the stage drafts from the picture on its own; typing over the draft stays
   * primary, and a saved take is never overwritten by this.
   */
  const [needsDraft, setNeedsDraft] = useState(false);
  const [autoDrafted, setAutoDrafted] = useState(false);

  const setChannel = (platform: string, patch: Partial<ChannelState>) => {
    setChannels((prev) => {
      const current = prev[platform] ?? { caption: "", hashtags: "", authored: false };
      return { ...prev, [platform]: { ...current, ...patch } };
    });
    setSaved(false);
  };

  // Restore what was saved. Without this, reopening the stage from the spine
  // shows an empty form over copy that exists, which is the same hole stage 01
  // had.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/creatives/${creativeId}/stages`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const copy = (body?.stages ?? []).find((s: { stageKind: string }) => s.stageKind === "copy");
        if (!copy) return;
        const takes = body?.takes?.[copy.id] ?? [];
        const cur = takes.find((t: { slotKey: string; isCurrent: boolean }) => t.slotKey === "copy" && t.isCurrent);
        const p = cur?.payload;
        if (!p || typeof p !== "object" || cancelled) {
          // Nothing saved for this stage yet — the guided opening drafts it.
          if (!cancelled) setNeedsDraft(true);
          return;
        }
        if (typeof p.hook === "string") setHook(p.hook);
        if (typeof p.base === "string") { setBase(p.base); setDerivedFrom(p.base); }
        if (p.channels && typeof p.channels === "object") setChannels(p.channels as Record<string, ChannelState>);
        setSaved(true);
      } catch { /* leave the form empty rather than blocking */ }
    })();
    return () => { cancelled = true; };
  }, [creativeId, stageId]);

  // The brand's banned terms drive the voice check, so it reflects THIS brand
  // rather than a generic idea of good writing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/creatives/${creativeId}/stages`);
        if (!res.ok) return;
        const b = await apiFetch(`/api/creatives/${creativeId}`);
        if (!b.ok || cancelled) return;
        const creative = await b.json();
        if (!creative?.brandId) return;
        const br = await apiFetch(`/api/brands/${creative.brandId}`);
        if (!br.ok || cancelled) return;
        const brand = await br.json();
        if (Array.isArray(brand?.bannedTerms)) setBanned(brand.bannedTerms);
      } catch { /* the check simply finds less */ }
    })();
    return () => { cancelled = true; };
  }, [creativeId]);

  const draft = useCallback(async () => {
    if (locked || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/copy-draft`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? "The copy could not be drafted.");
        return;
      }
      const drafted = body.drafted ?? {};
      const ig = drafted.instagram_feed;
      if (ig) {
        if (!hook.trim() && typeof ig.headline === "string") setHook(ig.headline);
        if (!base.trim() && typeof ig.caption === "string") { setBase(ig.caption); setDerivedFrom(ig.caption); }
      }
      setChannels((prev) => {
        const next = { ...prev };
        for (const p of platformOrder) {
          // A version you typed is never overwritten by a draft.
          if (next[p]?.authored) continue;
          const d = drafted[p];
          if (!d) continue;
          next[p] = {
            caption: typeof d.caption === "string" ? d.caption : "",
            hashtags: Array.isArray(d.hashtags) ? d.hashtags.join(" ") : "",
            authored: false,
          };
        }
        return next;
      });
      setSaved(false);
    } catch {
      setError("The copy could not be drafted.");
    } finally {
      setDrafting(false);
    }
  }, [creativeId, locked, drafting, hook, base]);

  // Fires at most once per open, only when the restore found nothing saved.
  useEffect(() => {
    if (!needsDraft || autoDrafted || locked || drafting || !selectedImageUrl) return;
    setAutoDrafted(true);
    void draft();
  }, [needsDraft, autoDrafted, locked, drafting, selectedImageUrl, draft]);

  async function save() {
    if (locked || saving) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/creatives/${creativeId}/stages/${stageId}/takes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotKey: "copy",
          // Typed by hand, so the engine auto-locks and an upstream re-run
          // cannot overwrite wording someone chose.
          origin: "user_typed",
          payload: { hook, base, channels },
          // Copy consumes the image it was written against. Recorded, not
          // assumed, so reopening Image correctly marks this stale.
          consumedFrom: [],
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  const hookChars = charCount(hook);
  const hookState = fitState(hookChars, HOOK_BUDGET);
  const hookReflows = hookChars > HOOK_REFLOW;

  const baseStale = derivedFrom !== "" && derivedFrom !== base;
  const offerable = useMemo(
    () => platformOrder.filter((p) => channels[p] && !channels[p].authored),
    [channels, platformOrder],
  );
  const baseNotes = voiceNotes(base, banned);

  if (!selectedImageUrl) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          Choose a picture in stage 03 first
          <InfoDot text="Copy is written against the picture, not in the abstract. Pick a take in stage 03 and press Use this; this stage opens with it." />
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      {/* The artifact, with the hook drawn as what it is: a layer over the picture. */}
      <div className="flex gap-4">
        <div className="relative w-[240px] shrink-0 overflow-hidden rounded-sm border border-border/60">
          <img src={selectedImageUrl} alt="" className="block h-auto w-full" />
          {hook.trim() && (
            <span className="pointer-events-none absolute inset-x-2 bottom-2 font-display text-[15px] uppercase leading-tight tracking-[0.01em] text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
              {hook}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="rounded-sm border border-l-2 border-border/60 border-l-grit-teal bg-card px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-grit-teal">Hook · a layer, not pixels</p>
              <span className={cn("font-mono text-[9.5px]", FIT_CLASS[hookState])} data-numeric>
                {hookChars}/{HOOK_BUDGET}
              </span>
            </div>
            <textarea
              value={hook}
              onChange={(e) => { setHook(e.target.value); setSaved(false); }}
              disabled={locked}
              rows={2}
              placeholder="Meet the newest name on the roster"
              aria-label="Hook, composited over the image"
              className="mt-1.5 w-full resize-none border-0 bg-transparent p-0 text-[16px] leading-snug text-foreground outline-none placeholder:text-dim disabled:opacity-70"
            />
            <p className="mt-1 text-[10.5px] leading-relaxed text-dim">
              {hookReflows
                ? "Past the fit threshold, so it wraps onto another line and the crops will need to reflow."
                : "Rewriting this costs nothing and never re-runs the image."}
            </p>
          </div>

          <div className="rounded-sm border border-border/60 bg-card px-3.5 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">Base caption</p>
            <textarea
              value={base}
              onChange={(e) => { setBase(e.target.value); setSaved(false); }}
              disabled={locked}
              rows={4}
              placeholder="Write it here, or draft it from the picture and edit."
              aria-label="Base caption"
              className="mt-1.5 w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-dim disabled:opacity-70"
            />
            {baseNotes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {baseNotes.map((n) => (
                  // Advisory, not a block: the model cannot know when a brand
                  // rule should bend, and you can.
                  <li key={n} className="text-[10.5px] leading-relaxed text-victory-gold">{n} Telling you, not stopping you.</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {baseStale && offerable.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-sm border border-victory-gold/40 bg-card px-3 py-2">
          <p className="text-[11px] leading-relaxed text-victory-gold">
            You changed the base. {offerable.length} channel version{offerable.length === 1 ? "" : "s"} were derived
            from the old one. Anything you wrote by hand is left alone.
          </p>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => { setChannels((prev) => { const n = { ...prev }; for (const p of offerable) delete n[p]; return n; }); setDerivedFrom(base); }}
              className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate"
            >
              Clear {offerable.length}
            </button>
            <button
              type="button"
              onClick={() => setDerivedFrom(base)}
              className="rounded-sm border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate"
            >
              Keep all four
            </button>
          </div>
        </div>
      )}

      {/*
        A brand with no connected account gets the sentence rather than an
        empty grid, because "no channels" and "still loading" look identical
        otherwise and only one of them is worth acting on.
      */}
      {emptyReason && <p className="text-[12.5px] leading-relaxed text-rebel-pink">{emptyReason}</p>}

      {/* Per channel: adapted, not truncated, with the real limit on screen. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {platformOrder.map((platform) => {
          const rule = RULES[platform];
          if (!rule) return null;
          const st = channels[platform] ?? { caption: "", hashtags: "", authored: false };
          const chars = charCount(st.caption);
          const state = fitState(chars, rule.caption);
          const tags = st.hashtags.split(/\s+/).filter(Boolean);
          const tagNote = tags.length > rule.hashtags ? `${tags.length} hashtags. ${rule.label} rewards about ${rule.hashtags}.` : null;
          return (
            <div key={platform} className="rounded-sm border border-border/60 bg-card p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">{rule.label}</p>
                <div className="flex items-center gap-1.5">
                  {st.authored && (
                    <span className="rounded-sm border border-grit-teal/40 px-1 py-px font-mono text-[8px] uppercase tracking-[0.09em] text-grit-teal">
                      Yours
                    </span>
                  )}
                  <span className={cn("font-mono text-[9.5px]", FIT_CLASS[state])} data-numeric>
                    {chars}/{rule.caption}
                  </span>
                </div>
              </div>
              <textarea
                value={st.caption}
                onChange={(e) => setChannel(platform, { caption: e.target.value, authored: true })}
                disabled={locked}
                rows={3}
                placeholder={`Adapted for ${rule.label}, not truncated.`}
                aria-label={`${rule.label} caption`}
                className="mt-1.5 w-full resize-none border-0 bg-transparent p-0 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-dim disabled:opacity-70"
              />
              <input
                value={st.hashtags}
                onChange={(e) => setChannel(platform, { hashtags: e.target.value, authored: true })}
                disabled={locked}
                placeholder="#hashtags"
                aria-label={`${rule.label} hashtags`}
                className="mt-1 w-full border-0 border-t border-border/40 bg-transparent px-0 pt-1.5 font-mono text-[10.5px] text-muted-foreground outline-none placeholder:text-dim disabled:opacity-70"
              />
              {tagNote && <p className="mt-1 text-[10px] text-victory-gold">{tagNote}</p>}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="rounded-sm border border-rebel-pink/40 bg-card px-3 py-2 text-[11px] leading-relaxed text-rebel-pink">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 rounded-sm border border-border/60 bg-card px-3.5 py-3">
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Typing is the point here. Drafting reads the picture you chose and fills what you have not written.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {saved && <span className="font-mono text-[9px] uppercase tracking-[0.09em] text-dim">Saved</span>}
          <button
            type="button"
            onClick={() => void draft()}
            disabled={locked || drafting}
            className="rounded-sm border border-border px-2.5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.09em] text-muted-foreground hover-elevate disabled:opacity-50"
          >
            {drafting ? "Drafting" : "Draft from the picture"}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={locked || saving || (!hook.trim() && !base.trim())}
            className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.09em] text-primary-foreground hover-elevate disabled:opacity-50"
          >
            {saving ? "Saving" : "Save the copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
