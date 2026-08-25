/**
 * Which variable supplies the direct Google AI key, and which must never.
 *
 * These exist because reading exactly one spelling of the name took image
 * generation and every layer edit off the air on a workspace that HAD the key,
 * and the symptom was a vendor error about an unsupported endpoint. The
 * expensive part was not the fix; it was believing the key was absent.
 */
import {
  DIRECT_GEMINI_KEY_VARS,
  directGeminiKeyNames,
  isUsableApiKey,
  resolveDirectGeminiKey,
} from "@workspace/integrations-gemini-ai/api-key";

export interface CaseResult {
  name: string;
  ok: boolean;
  detail?: string;
}

export function runCases(): CaseResult[] {
  const out: CaseResult[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    out.push({ name, ok, detail: ok ? undefined : String(detail) });

  const REAL = "AIzaSyExampleExampleExampleExampleExample";

  check("GEMINI_API_KEY is preferred when present",
    resolveDirectGeminiKey({ GEMINI_API_KEY: REAL, GOOGLE_AI_VISION_API_KEY: "other" })?.varName === "GEMINI_API_KEY");

  // The whole point of the change: this workspace stores it here.
  check("GOOGLE_AI_VISION_API_KEY is accepted as a direct key",
    resolveDirectGeminiKey({ GOOGLE_AI_VISION_API_KEY: REAL })?.key === REAL,
    resolveDirectGeminiKey({ GOOGLE_AI_VISION_API_KEY: REAL }));

  check("GOOGLE_API_KEY is accepted too — it is the SDK's own convention",
    resolveDirectGeminiKey({ GOOGLE_API_KEY: REAL })?.varName === "GOOGLE_API_KEY");

  /*
   * The one that must never be treated as a direct key. It is the proxy's
   * credential, and on this workspace its value is a placeholder. veo.ts used
   * to fall back to it, which converted "not configured" into "auth rejected".
   */
  check("the proxy's AI_INTEGRATIONS_GEMINI_API_KEY is NEVER a direct key",
    resolveDirectGeminiKey({ AI_INTEGRATIONS_GEMINI_API_KEY: REAL }) === null);
  check("and it is not in the accepted list at all",
    !(DIRECT_GEMINI_KEY_VARS as readonly string[]).includes("AI_INTEGRATIONS_GEMINI_API_KEY"));

  check("_DUMMY_API_KEY_ is rejected — a truthy placeholder is worse than nothing",
    resolveDirectGeminiKey({ GEMINI_API_KEY: "_DUMMY_API_KEY_" }) === null);
  check("other placeholder shapes are rejected too",
    ["dummy", "DUMMY", "placeholder", "changeme", "change_me", "TODO", "xxx", "your-api-key", "your_key"]
      .every(v => resolveDirectGeminiKey({ GEMINI_API_KEY: v }) === null));

  check("whitespace-only is rejected", resolveDirectGeminiKey({ GEMINI_API_KEY: "   " }) === null);
  check("a real key is trimmed", resolveDirectGeminiKey({ GEMINI_API_KEY: `  ${REAL}  ` })?.key === REAL);
  check("nothing set resolves to null, which is the proxy fallback",
    resolveDirectGeminiKey({}) === null);

  /*
   * A placeholder in the FIRST name must not shadow a real key in a later one.
   * This is the exact shape of the live workspace: the proxy-style placeholder
   * present, the real key under a different name.
   */
  check("a placeholder in an earlier name does not shadow a real key in a later one",
    resolveDirectGeminiKey({ GEMINI_API_KEY: "_DUMMY_API_KEY_", GOOGLE_AI_VISION_API_KEY: REAL })?.varName
      === "GOOGLE_AI_VISION_API_KEY");

  check("isUsableApiKey rejects non-strings", !isUsableApiKey(undefined) && !isUsableApiKey(null) && !isUsableApiKey(42));
  check("a key that merely CONTAINS 'dummy' later on is still usable",
    isUsableApiKey("AIzaSyRealKeyThatHappensToSayDummyInside"));

  // The message has to name the alternatives or it repeats the original failure.
  check("the error text names every accepted variable",
    DIRECT_GEMINI_KEY_VARS.every(v => directGeminiKeyNames().includes(v)),
    directGeminiKeyNames());

  return out;
}
