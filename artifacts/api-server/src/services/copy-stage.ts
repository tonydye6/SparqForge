/**
 * Stage 04 · Copy · the rules, kept pure.
 *
 * The load-bearing decision this stage exists to express: TEXT ON THE IMAGE IS A
 * LIVE COMPOSITED LAYER, NOT GENERATED PIXELS. The hook sits over the picture, so
 * rewriting it costs nothing and NEVER restales stage 03. That is what makes Copy
 * a real stage rather than a caption box, and it kills the most common reason
 * people re-roll an image they were happy with.
 *
 * The second rule, from screen 12 and worth keeping verbatim: the closer an
 * artifact is to something you could make by hand, the more the interface should
 * let you make it by hand. Text is the closest thing in the product, so direct
 * typing is primary and instruction is secondary. Everything here supports typing
 * first: limits you can see, a voice check that informs rather than blocks, and
 * derived channel versions that are OFFERED a re-derive rather than given one.
 *
 * No DB, no clock, no randomness.
 */

export interface PlatformCopyRule {
  label: string;
  /** Hard API limit for the caption body. */
  caption: number;
  /** Conventional hashtag count, not an API limit. Advisory. */
  hashtags: number;
}

/**
 * Real platform limits, not invented ones. A limit that is wrong in the
 * permissive direction lets someone write copy the platform will truncate at
 * publish time, which is a failure discovered by the audience rather than by us.
 */
export const PLATFORM_COPY_RULES: Record<string, PlatformCopyRule> = {
  instagram_feed: { label: "Instagram feed", caption: 2200, hashtags: 30 },
  instagram_story: { label: "Instagram story", caption: 2200, hashtags: 10 },
  twitter: { label: "X", caption: 280, hashtags: 3 },
  linkedin: { label: "LinkedIn", caption: 3000, hashtags: 5 },
  tiktok: { label: "TikTok", caption: 2200, hashtags: 5 },
  youtube: { label: "YouTube", caption: 5000, hashtags: 15 },
};

export const COPY_PLATFORMS = Object.keys(PLATFORM_COPY_RULES);

/**
 * The limit actually in force: the platform's hard cap, tightened by a brand
 * rule if the brand set one.
 *
 * A brand rule can only ever make the limit SMALLER. `brands.platformRules`
 * is hand-edited config, and a value above the API's real cap would be a
 * promise the platform will not keep.
 */
export function effectiveCaptionLimit(
  platform: string,
  platformRules?: Record<string, { char_limit?: number }> | null,
): number {
  const hard = PLATFORM_COPY_RULES[platform]?.caption ?? 2200;
  const brand = platformRules?.[platform]?.char_limit;
  if (typeof brand !== "number" || !Number.isFinite(brand) || brand <= 0) return hard;
  return Math.min(hard, Math.floor(brand));
}

export type FitState = "ok" | "tight" | "over";

export interface CopyFit {
  chars: number;
  limit: number;
  remaining: number;
  state: FitState;
}

/** Within 10% of the cap counts as tight: room to warn before it is a problem. */
const TIGHT_FRACTION = 0.9;

export function captionFit(text: string, limit: number): CopyFit {
  const chars = [...text].length;
  const remaining = limit - chars;
  const state: FitState = chars > limit ? "over" : chars >= limit * TIGHT_FRACTION ? "tight" : "ok";
  return { chars, limit, remaining, state };
}

/**
 * The on-image hook's character budget.
 *
 * Not an API limit: a physical one. Past roughly this many characters a headline
 * stops reading as a headline at feed size and has to reflow onto more lines,
 * which changes the composition the image was framed for. Stage 05 is what
 * actually reflows it, which is why a hook change restales crops and nothing
 * else.
 */
export const HOOK_BUDGET_CHARS = 42;
export const HOOK_REFLOW_CHARS = 64;

export interface HookFit extends CopyFit {
  /** True once the hook must wrap onto another line. */
  reflows: boolean;
}

export function hookFit(text: string): HookFit {
  const base = captionFit(text, HOOK_BUDGET_CHARS);
  return { ...base, reflows: base.chars > HOOK_REFLOW_CHARS };
}

// ── Voice check ──────────────────────────────────────────────────────────────

export interface VoiceNote {
  /** Machine-readable so the UI can style without string matching. */
  kind: "banned_term" | "length" | "shouting" | "hashtags_in_body";
  message: string;
}

/**
 * The voice check, whose CHARACTER changes with authorship.
 *
 * Screen 12's rule: a constraint on the model, a note to the human. The model
 * cannot know when a brand rule should bend; the user can. So generated copy is
 * held to the contract and the user's own copy gets an advisory. This function
 * returns the same findings either way and lets the caller decide the verb,
 * because a checker that silently softened its findings for authored text would
 * be hiding information rather than deferring.
 */
export function voiceCheck(text: string, bannedTerms: string[] = []): VoiceNote[] {
  const notes: VoiceNote[] = [];
  const lower = text.toLowerCase();

  for (const term of bannedTerms) {
    const t = term.trim().toLowerCase();
    if (t && lower.includes(t)) {
      notes.push({ kind: "banned_term", message: `"${term.trim()}" is on this brand's banned list.` });
    }
  }

  const letters = [...text].filter(c => /[a-z]/i.test(c));
  const caps = letters.filter(c => c === c.toUpperCase());
  if (letters.length >= 12 && caps.length / letters.length > 0.6) {
    notes.push({ kind: "shouting", message: "Mostly capitals. Reads as shouting rather than confident." });
  }

  if (/#\w+/.test(text)) {
    notes.push({
      kind: "hashtags_in_body",
      message: "Hashtags are in the caption body. They have their own slot, where per-channel counts apply.",
    });
  }

  return notes;
}

// ── Per-channel derivation ───────────────────────────────────────────────────

export interface ChannelCopy {
  platform: string;
  caption: string;
  hashtags: string[];
  /** True when a person typed this version, which protects it from re-derives. */
  authored: boolean;
}

/**
 * Which channel versions are OFFERED a re-derive after the base caption changed.
 *
 * Offered, never given (screen 12). And a channel version the user wrote by hand
 * is excluded outright: silently regenerating wording someone chose is the trap
 * that makes direct editing unsafe, and direct editing is this stage's primary
 * path.
 */
export function channelsToOffer(channels: ChannelCopy[]): string[] {
  return channels.filter(c => !c.authored).map(c => c.platform);
}

/**
 * What a copy edit invalidates.
 *
 * Crops only, and NEVER the image. The hook is a composited layer over the
 * picture, so rewriting it cannot change a pixel of stage 03; what it does change
 * is how the text reflows inside each channel's safe area, which is stage 05's
 * job. Returning "asset" here would resurrect the exact behaviour this stage was
 * designed to kill: re-rolling an image you were happy with because you changed
 * a word.
 */
export function stagesStaledByCopy(): Array<"crops"> {
  return ["crops"];
}

/**
 * Hashtag count against the channel's convention.
 *
 * Advisory, not a limit: platforms accept more than convention rewards, so this
 * informs rather than blocks.
 */
export function hashtagNote(platform: string, hashtags: string[]): string | null {
  const rule = PLATFORM_COPY_RULES[platform];
  if (!rule || hashtags.length <= rule.hashtags) return null;
  return `${hashtags.length} hashtags. ${rule.label} rewards about ${rule.hashtags}.`;
}

/** Normalise a hashtag: one leading #, no whitespace, no empties. */
export function normalizeHashtag(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return cleaned ? `#${cleaned}` : null;
}

export function normalizeHashtags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = normalizeHashtag(item);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}
