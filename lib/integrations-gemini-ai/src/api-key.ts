/**
 * WHICH ENVIRONMENT VARIABLE HOLDS A DIRECT GOOGLE AI API KEY.
 *
 * `client.ts` prefers a direct key because the Replit-managed proxy cannot serve
 * the models this app pins (`gemini-3-pro-image`, `gemini-omni-flash-preview`,
 * `gemini-3.5-flash`) — it answers `POST /interactions` with "Endpoint is not
 * supported". Until 2026-08-23 the only name it read was `GEMINI_API_KEY`, and
 * when that was absent it silently fell back to the proxy, so every image
 * generation and every layer edit failed with a vendor error that named a
 * missing endpoint rather than a missing key. Diagnosing it took an hour and
 * ended in the wrong conclusion twice ("the key is absent" — it was not; "the
 * api restart broke it" — it did not).
 *
 * The key WAS provisioned. It was under `GOOGLE_AI_VISION_API_KEY`. A Google API
 * key's capabilities come from the APIs enabled on its project, not from the
 * name someone stored it under, so reading only one spelling turned a naming
 * choice into a total outage of image generation.
 *
 * `AI_INTEGRATIONS_GEMINI_API_KEY` is deliberately NOT in this list. It is the
 * proxy's own credential, it is paired with `AI_INTEGRATIONS_GEMINI_BASE_URL`,
 * and on this workspace its value is the literal string `_DUMMY_API_KEY_`.
 * Treating it as a direct key — which `veo.ts` used to do — sends a placeholder
 * to Google and gets an auth error instead of a configuration error.
 */
export const DIRECT_GEMINI_KEY_VARS = [
  "GEMINI_API_KEY",
  "GOOGLE_AI_VISION_API_KEY",
  "GOOGLE_API_KEY",
] as const;

/**
 * Placeholders that are worse than an empty value, because they are truthy.
 * `_DUMMY_API_KEY_` is what Replit injects for a proxy-backed integration.
 */
const PLACEHOLDER = /^_*(dummy|placeholder|changeme|change_me|todo|xxx|your[-_ ]?(api[-_ ]?)?key)/i;

/** A value that can actually be sent to Google. */
export function isUsableApiKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  return v.length > 0 && !PLACEHOLDER.test(v);
}

export interface ResolvedGeminiKey {
  key: string;
  /** The variable it came from, so errors and logs can name it. */
  varName: string;
}

/**
 * The first usable direct key, in preference order, or null to fall back to the
 * proxy. Pure and env-injectable so it can be asserted without touching
 * `process.env`.
 */
export function resolveDirectGeminiKey(
  env: Record<string, string | undefined> = process.env,
): ResolvedGeminiKey | null {
  for (const varName of DIRECT_GEMINI_KEY_VARS) {
    const value = env[varName];
    if (isUsableApiKey(value)) return { key: value.trim(), varName };
  }
  return null;
}

/** One sentence naming every accepted spelling, for error and warning text. */
export function directGeminiKeyNames(): string {
  return DIRECT_GEMINI_KEY_VARS.join(", ");
}
