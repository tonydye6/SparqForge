import { directGeminiKeyNames } from "@workspace/integrations-gemini-ai/api-key";

/**
 * TELL A CONFIGURATION FAULT FROM A CONTENT FAULT.
 *
 * Every generation route ends in a catch that says some version of "that could
 * not be made, nothing was charged". That sentence is true and, for a model
 * refusal or a timeout, it is the right thing to say. For a misconfigured API
 * key it is actively misleading: the operator reads it as "the model would not
 * do it" and starts rewriting the prompt, when nothing they type can ever work.
 *
 * On 2026-08-23 this cost an hour. Image generation was dead on the dev
 * workspace and the surfaced message was "That edit could not be made", while
 * the real error underneath was, in order: the Replit proxy answering
 * "Endpoint: 'POST /interactions' is not supported" (because no direct key was
 * being read), and then — once the key was read from the name it was actually
 * stored under — Google answering 403 `API_KEY_SERVICE_BLOCKED` for
 * `generativelanguage.googleapis.com`, meaning that key carries API
 * restrictions that exclude the Generative Language API.
 *
 * Neither of those is a creative failure and neither is fixable from the UI, so
 * neither should look like one.
 */

/** Anything the vendor SDKs throw, flattened to text we can match on. */
function flatten(err: unknown): string {
  if (err === null || err === undefined) return "";
  if (typeof err === "string") return err;
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number") { parts.push(String(v)); return; }
    if (typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);
    if (v instanceof Error) { parts.push(v.message); walk((v as { cause?: unknown }).cause, depth + 1); }
    for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
  };
  walk(err, 0);
  return parts.join(" ");
}

/**
 * A sentence for the operator when the failure is configuration, or null when
 * it is not — in which case the caller's own wording stands.
 */
export function describeVendorConfigError(err: unknown): string | null {
  const text = flatten(err);
  if (!text) return null;

  // The Replit proxy cannot serve the pinned models. Only reachable when no
  // direct key resolved, so the fix is the key, not the endpoint.
  if (/is not supported/i.test(text) && /interactions/i.test(text)) {
    return "Image generation is not configured on this environment: no direct Google AI key was " +
      `found (looked for ${directGeminiKeyNames()}), so the request went to the Replit AI proxy, ` +
      "which cannot serve this model. Nothing was changed or charged.";
  }

  if (/API_KEY_SERVICE_BLOCKED/i.test(text)) {
    return "The Google AI key on this environment is restricted and does not permit the " +
      "Generative Language API, so no image can be generated. Allow " +
      "generativelanguage.googleapis.com on that key's API restrictions, or set an unrestricted " +
      `key in one of ${directGeminiKeyNames()}. Nothing was changed or charged.`;
  }

  if (/API_KEY_INVALID/i.test(text) || /API key not valid/i.test(text)) {
    return `The Google AI key on this environment was rejected as invalid (set in one of ` +
      `${directGeminiKeyNames()}). Nothing was changed or charged.`;
  }

  if (/SERVICE_DISABLED/i.test(text) || /has not been used in project/i.test(text)) {
    return "The Generative Language API is disabled on the Google project behind this " +
      "environment's AI key. Enable it, then retry. Nothing was changed or charged.";
  }

  // A bare PERMISSION_DENIED with no more specific reason is still a config
  // fault, and still not something the operator can prompt their way out of.
  if (/PERMISSION_DENIED/i.test(text)) {
    return "Google denied this request with PERMISSION_DENIED, which is a key or project " +
      "configuration fault rather than anything about the picture. Nothing was changed or charged.";
  }

  return null;
}
