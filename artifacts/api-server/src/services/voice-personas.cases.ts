/**
 * Assertions for the stage 04 voice personas.
 *
 * The ones that matter are about PRECEDENCE and about the rules being
 * observable. A persona that quietly outranks the brand is a trademark and
 * voice problem, not a style one, and a persona whose rules read "warm and
 * authentic" cannot be evaluated by a person or a model.
 */
import {
  VOICE_PERSONAS,
  findVoicePersona,
  voicePersonaOptions,
  voicePersonaPrompt,
} from "./voice-personas.js";

export interface Result { name: string; ok: boolean; detail?: unknown }

export function runCases(): Result[] {
  const results: Result[] = [];
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    results.push({ name, ok, detail: ok ? undefined : detail });
  };

  // ---- the roster ----
  check("five personas, not six", VOICE_PERSONAS.length === 5, VOICE_PERSONAS.length);
  /*
   * "The Receipts" was cut on approval. It is asserted ABSENT rather than just
   * left out, because the reason is a rule: a values-claim voice selectable for
   * any caption manufactures the performative claim the brand guide forbids.
   */
  check(
    "the values/proof persona is absent by decision, not by accident",
    !VOICE_PERSONAS.some(p => /receipt|values|proof/i.test(p.id + p.name)),
    VOICE_PERSONAS.map(p => p.id),
  );
  check("ids are unique", new Set(VOICE_PERSONAS.map(p => p.id)).size === VOICE_PERSONAS.length);
  check("ids are stable kebab-case", VOICE_PERSONAS.every(p => /^[a-z][a-z-]*[a-z]$/.test(p.id)), VOICE_PERSONAS.map(p => p.id));
  check("every persona names where to reach for it", VOICE_PERSONAS.every(p => p.bestFor.trim().length > 0));
  check("every persona carries its own failure mode", VOICE_PERSONAS.every(p => p.failureMode.trim().length > 0));

  // ---- rules must be OBSERVABLE, per the research this was built from ----
  check("every persona has at least three rules", VOICE_PERSONAS.every(p => p.rules.length >= 3), VOICE_PERSONAS.map(p => p.rules.length));
  /*
   * "use contractions, address the reader as you, keep social sentences under 20
   * words" is operational; "warm and authentic" is not. A rule that is only an
   * adjective cannot be checked by anyone.
   */
  const VAGUE = /^(be |sound |feel )?(warm|authentic|genuine|engaging|human|relatable|on-brand)\b/i;
  check(
    "no rule is a bare adjective",
    VOICE_PERSONAS.every(p => p.rules.every(r => !VAGUE.test(r.trim()))),
    VOICE_PERSONAS.flatMap(p => p.rules.filter(r => VAGUE.test(r.trim()))),
  );
  check("every rule is a sentence, not a label", VOICE_PERSONAS.every(p => p.rules.every(r => r.trim().length > 12)));

  // ---- the prompt fragment ----
  const gc = findVoicePersona("group-chat")!;
  const prompt = voicePersonaPrompt(gc);
  check("the fragment names the persona", prompt.includes("The Group Chat"));
  check("the fragment carries every rule", gc.rules.every(r => prompt.includes(r)));
  check("the fragment carries the failure mode as a prohibition", prompt.includes("Do not: "));
  /*
   * THE LOAD-BEARING ONE. Without an explicit loser, a strongly-drawn voice
   * reads as licence to reach for the vocabulary the brand's banned-terms list
   * forbids, and nothing tells the model which instruction outranks the other.
   */
  check(
    "the fragment says the brand wins a conflict, in words",
    /brand wins/i.test(prompt) && /TONE ONLY/i.test(prompt),
    prompt,
  );
  check(
    "the example is offered as a register anchor, not as copy to reuse",
    /do not copy it/i.test(prompt),
  );
  check("every persona produces a fragment that defers to the brand", VOICE_PERSONAS.every(p => /brand wins/i.test(voicePersonaPrompt(p))));

  // ---- lookup ----
  check("an unknown id resolves to nothing rather than a default", findVoicePersona("nope") === null);
  check("null and undefined are the no-persona case", findVoicePersona(null) === null && findVoicePersona(undefined) === null);
  check("a known id resolves", findVoicePersona("coach")?.name === "The Coach");

  // ---- what the client is allowed to see ----
  const opts = voicePersonaOptions();
  check("the picker gets every persona", opts.length === VOICE_PERSONAS.length);
  /*
   * The prompt-only fields stay server-side. They are the instruction, not a
   * description of the product, and shipping them to the client invites someone
   * to render them as standing UI text — which doc 38 §3 forbids anyway.
   */
  check(
    "the picker does NOT receive rules, failure modes or examples",
    opts.every(o => !("rules" in o) && !("failureMode" in o) && !("example" in o)),
    Object.keys(opts[0] ?? {}),
  );

  return results;
}
