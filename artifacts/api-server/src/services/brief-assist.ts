/**
 * The entrance's two assists: Improve, and a conversation with the director.
 *
 * Spec: the approved entrance mock (artifact 6056f09f, screens 2 and 3) and
 * Tony's rules from that review, which this module enforces in code the same
 * way brief-intake.ts enforces the interview rules:
 *
 *   1. IMPROVE IS AN ACTION, NOT A MODE. One press, one proposal. The user's
 *      line is returned untouched beside it, and nothing here can write.
 *   2. THE DIRECTOR LEAD IS A REAL CONVERSATION. Freeform text is primary;
 *      chips are shortcuts the director MAY offer, never the only answers.
 *      `normalizeReply` drops chips beyond the cap rather than letting the
 *      model turn the chat back into a form.
 *   3. THE BRIEF-SO-FAR SEPARATES WHOSE WORDS ARE WHOSE. `yours` is carried
 *      verbatim from the last user-authored text and is NEVER model output.
 *      Only `directors` comes from the model. The UI renders the split; this
 *      contract is what makes the split honest.
 *
 * Pure, and runnable under tsx like the other services carrying invariants.
 * The model calls live in the route; everything here is prompt construction
 * and response discipline.
 */

// ── shapes ───────────────────────────────────────────────────────────────────

export interface DirectorVoice {
  id: string;
  name: string;
  /** Prompt-injectable prose off the persona row; empty strings for house. */
  composition: string;
  mood: string;
  colorPhilosophy: string;
}

export interface BrandContext {
  name: string;
  voiceDescription: string | null;
  bannedTerms: string[] | null;
}

export interface CollabMessage {
  role: "you" | "director";
  text: string;
}

export interface CollabReply {
  /** The director's next message, in their voice. */
  message: string;
  /** Optional quick answers. Shortcuts only; capped, never required. */
  chips: string[];
  /** What the model will assume if the user just presses Start. */
  assumption: string | null;
  /** The director's framing so far, to render beside the user's own words. */
  directors: string;
}

/** At most this many chips, so the conversation never collapses into a form. */
export const MAX_CHIPS = 3;

/** Improve returns exactly one proposal; Retry is a new call, not a list. */
export interface ImproveReply {
  proposal: string;
}

// ── prompts ──────────────────────────────────────────────────────────────────

export function buildImprovePrompt(briefText: string, brand: BrandContext): string {
  const banned = (brand.bannedTerms ?? []).filter(Boolean);
  return `You are improving a one-line social post brief for ${brand.name}.
${brand.voiceDescription ? `The brand's voice: ${brand.voiceDescription}` : ""}
${banned.length ? `Never use these words: ${banned.join(", ")}.` : ""}

The creator's brief: "${briefText.trim()}"

Rewrite it as ONE stronger brief of at most 60 words: concrete subject, one vivid visual moment,
the platform-ready energy of the original intent. Keep every proper noun the creator used. Do not
add hashtags, emoji or quotation marks. Respond with ONLY the improved brief text, nothing else.`;
}

export function buildCollabSystem(voice: DirectorVoice, brand: BrandContext): string {
  const style = [voice.composition, voice.mood, voice.colorPhilosophy]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
  return `You are ${voice.name}, an art director leading a short working conversation to sharpen a
social post brief for ${brand.name}.${style ? ` Your style: ${style}` : ""}
${brand.voiceDescription ? `The brand's voice: ${brand.voiceDescription}` : ""}

How you work, all mandatory:
- Talk like a director in a room, not a form. One thought per message, at most three sentences.
- Push toward ONE concrete frame: what is in the picture, at what instant.
- Ask at most one question per message, and only if the answer would visibly change the image.
- You may offer up to ${MAX_CHIPS} short quick-answer options when a question has natural choices,
  but the creator can always type anything instead.
- When you ask a question, state what you will assume if they skip it.
- Never rewrite the creator's own words; you add framing beside them.

Respond with ONLY JSON, no markdown fence:
{"message": string, "chips": [string], "assumption": string|null, "directors": string}
"directors" is your framing of the brief so far in one or two sentences, updated each turn.`;
}

// ── response discipline ──────────────────────────────────────────────────────

/**
 * Whatever the model returned, the contract holds.
 *
 * The rules this enforces are the ones a prompt regression would quietly
 * break: chips beyond the cap are dropped (rule 2), a missing message becomes
 * an explicit failure rather than an empty bubble, and `directors` never
 * exceeds a couple of sentences of framing.
 */
export function normalizeReply(raw: unknown): CollabReply | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message.trim() : "";
  if (!message) return null;

  const chips = Array.isArray(r.chips)
    ? r.chips
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim())
        .slice(0, MAX_CHIPS)
    : [];

  const assumption =
    typeof r.assumption === "string" && r.assumption.trim() ? r.assumption.trim() : null;

  const directors = typeof r.directors === "string" ? r.directors.trim().slice(0, 600) : "";

  return { message, chips, assumption, directors };
}

/** Improve's discipline: one line of text, stripped of wrapping quotes. */
export function normalizeImprove(raw: string): ImproveReply | null {
  const text = raw.trim().replace(/^["'“]|["'”]$/g, "").trim();
  if (!text || text.length > 600) return null;
  return { proposal: text };
}

/**
 * The user's side of the brief, taken from the conversation.
 *
 * Rule 3 made mechanical: `yours` is the concatenation of what the USER typed,
 * newest statement of the idea first — in practice the first message is the
 * brief line and later messages refine it, so all of them belong to the user's
 * side. Nothing the director said can enter it, by construction.
 */
export function yoursFrom(messages: readonly CollabMessage[]): string {
  return messages
    .filter((m) => m.role === "you")
    .map((m) => m.text.trim())
    .filter(Boolean)
    .join(" ");
}

/** Conversation shipped to the model: alternating turns, oldest first. */
export function toModelMessages(
  messages: readonly CollabMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m) => m.text.trim().length > 0)
    .map((m) => ({
      role: m.role === "you" ? ("user" as const) : ("assistant" as const),
      content: m.text.trim(),
    }));
}
