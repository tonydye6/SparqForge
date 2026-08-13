/**
 * Stage 04 · Copy · WHO IS TALKING.
 *
 * Tony, 2026-08-12, after disliking the stale captions coming back: give the
 * user a voice to pick per caption, leaning into what actually lands with Gen Z
 * and millennial audiences. Five personas, approved from six — "The Receipts"
 * (values/proof-led) was cut deliberately: the brand guide requires operational
 * proof before any values claim, and a persona that can be selected for ANY
 * caption would manufacture exactly the performative claim the guide warns
 * against. If it comes back, it must refuse to write without a checkable fact.
 *
 * THREE THINGS THIS IS NOT.
 *
 * 1. **Not a designer persona.** Those are `designer_personas`, they live at
 *    stage 02, and they decide how the work is COMPOSED. These decide how it
 *    SOUNDS. The governing line from the brand system holds for both: the
 *    designer decides how it is composed, the brand decides what it is made of,
 *    and neither may overrule palette, mark or voice.
 *
 * 2. **Not an intensity setting.** `Sparq-Brand-System-v1` already has a dial —
 *    Signal / Charge / Chaos — and that is the one that fixes ground, type case,
 *    texture and disruption together. A voice persona says WHO is talking; the
 *    dial says HOW LOUD. Letting a persona set intensity too would give the
 *    system two axes fighting over the same knobs.
 *
 * 3. **Not a table.** These are five curated system voices, not user content, so
 *    they live in code where they can be asserted and cannot drift per brand.
 *    The moment somebody needs to edit or add one, this becomes a table — but
 *    inventing that table before anyone has asked is how the layer arc's dead
 *    columns happened.
 *
 * PRECEDENCE IS THE WHOLE DESIGN. The fragment this module produces is appended
 * BENEATH the brand contract in `buildImageAwareCaption`, and says so in words.
 * A persona shades the voice; the brand's `bannedTerms`, `trademarkRules` and
 * `voiceDescription` always win. Sparq's own ban list already covers the
 * research's worst offenders ("unlock", "supercharge", "seamless", "next-gen",
 * "learn more"), so the personas do not restate them.
 */

export interface VoicePersona {
  id: string;
  name: string;
  /** One line for the picker. */
  energy: string;
  /** What the reader should consistently get. */
  promise: string;
  /** When a person should reach for it — shown as the picker's hint. */
  bestFor: string;
  /** Observable, checkable writing rules. "Warm and authentic" is not a rule. */
  rules: string[];
  /** The specific way THIS voice fails, named so the model can avoid it. */
  failureMode: string;
  /** One caption in a real Sparq context, as a tone anchor. */
  example: string;
}

export const VOICE_PERSONAS: readonly VoicePersona[] = [
  {
    id: "group-chat",
    name: "The Group Chat",
    energy: "Online, quick, self-aware",
    promise: "You feel like you already knew, and you want to tell someone.",
    bestFor: "Character drops, community moments, reveals",
    rules: [
      "Keep social sentences under 20 words.",
      "Address the reader as 'you'. Use contractions.",
      "Reference culture only where it genuinely fits the post; never explain the joke.",
      "No more than one emoji, and only when it carries meaning a word would not.",
    ],
    failureMode: "Fellow-kids slang worn as a costume, or over-explaining a reference until it dies.",
    example: "Samantha just entered the court. Your roster is already outdated.",
  },
  {
    id: "patch-notes",
    name: "The Patch Notes",
    energy: "Transparent, specific, mildly nerdy",
    promise: "You know exactly what changed and whether it affects you.",
    bestFor: "Feature ships, balance changes, studio updates",
    rules: [
      "Say what shipped, what changed, and what it costs the player.",
      "Use numbers and specifics rather than adjectives.",
      "Name the tradeoff when there is one.",
      "Lead with the player outcome, not the engineering.",
    ],
    failureMode: "A changelog nobody can parse, or a release note inflated into an announcement.",
    example: "Charged Serve got 12% faster and slightly less forgiving. Both on purpose.",
  },
  {
    id: "trash-talk",
    name: "The Trash Talk",
    energy: "Confident, competitive, meme-capable",
    promise: "You feel the rivalry and you want in.",
    bestFor: "Gameday, results, rivalry, Rumble U",
    rules: [
      "Short, punchy lines. Swagger, controlled.",
      "Keep the product benefit legible underneath the bravado.",
      "Aim at the matchup or at us — never at a real person.",
      "Earn the boast with something in the post; never boast about nothing.",
    ],
    failureMode: "Empty hype with no claim under it, or trash talk that punches at real people.",
    example: "You brought a bracket. We brought the whole gauntlet.",
  },
  {
    id: "open-lobby",
    name: "The Open Lobby",
    energy: "Imaginative, inclusive, community-led",
    promise: "You are a collaborator here, not an audience.",
    bestFor: "Creator features, UGC, remixes, Mascot Mayhem",
    rules: [
      "Foreground what players made, before what we made.",
      "Invite rather than instruct; end on an opening, not a command.",
      "Celebrate the unconventional attempt, including the broken one.",
      "Use 'we' for the studio and 'you' for the player, never the reverse.",
    ],
    failureMode: "Asking for engagement without giving anything to build on.",
    example: "You broke the mascot physics. We kept it. Ship your worst.",
  },
  {
    id: "coach",
    name: "The Coach",
    energy: "Calm, useful, anti-hype",
    promise: "You know the next step and you are not being rushed.",
    bestFor: "Onboarding, how-to, troubleshooting, support",
    rules: [
      "Explain plainly. Minimal slang, no hype.",
      "Give one clear next step and hand control back to the reader.",
      "Relieve the anxiety the reader arrived with; never manufacture urgency.",
      "Short active sentences. No exclamation marks.",
    ],
    failureMode: "Manufactured urgency, or a wall of instructions with no first step.",
    example: "New here? Pick a team, run one match, decide after. Nothing's locked in.",
  },
] as const;

export function findVoicePersona(id: string | null | undefined): VoicePersona | null {
  if (!id) return null;
  return VOICE_PERSONAS.find(p => p.id === id) ?? null;
}

/**
 * The prompt fragment, written to sit UNDERNEATH the brand contract.
 *
 * The precedence sentence is not decoration. Without it a strongly-drawn voice
 * ("swagger", "meme-capable") reads as licence to reach for the exact vocabulary
 * the brand's `bannedTerms` forbids, and the model has no way to know which
 * instruction outranks the other. Naming the loser explicitly is cheaper than
 * discovering it in a published caption.
 */
export function voicePersonaPrompt(persona: VoicePersona): string {
  return [
    `VOICE PERSONA: ${persona.name} — ${persona.energy}.`,
    `What the reader should get: ${persona.promise}`,
    "How this voice writes:",
    ...persona.rules.map(r => `- ${r}`),
    `Do not: ${persona.failureMode}`,
    `Tone anchor (do not copy it, match its register): "${persona.example}"`,
    "This persona shapes TONE ONLY. Where it conflicts with the brand voice, the",
    "trademark rules or the never-use list above, the brand wins every time.",
  ].join("\n");
}

/** What the picker needs; the prompt-only fields stay on the server. */
export function voicePersonaOptions(): Array<Pick<VoicePersona, "id" | "name" | "energy" | "bestFor">> {
  return VOICE_PERSONAS.map(({ id, name, energy, bestFor }) => ({ id, name, energy, bestFor }));
}
