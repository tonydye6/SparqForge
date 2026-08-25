import { GoogleGenAI } from "@google/genai";
import { directGeminiKeyNames, resolveDirectGeminiKey } from "./api-key.js";

// Prefer the user's own Google AI API key (direct Google API) when set.
// This unlocks models not available through the Replit-managed proxy
// (gemini-3-pro-image, gemini-omni-flash-preview, gemini-3.5-flash).
// Falls back to the Replit AI Integrations proxy when no direct key is set.
//
// The key may be stored under any of several names — see api-key.ts for why
// reading only "GEMINI_API_KEY" silently disabled image generation on a
// workspace that had the key under "GOOGLE_AI_VISION_API_KEY".
const direct = resolveDirectGeminiKey();

if (!direct) {
  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    throw new Error(
      `Set a direct Google AI key (${directGeminiKeyNames()}) or AI_INTEGRATIONS_GEMINI_BASE_URL. ` +
        "Did you forget to provision the Gemini AI integration?",
    );
  }
  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    throw new Error(
      `Set a direct Google AI key (${directGeminiKeyNames()}) or AI_INTEGRATIONS_GEMINI_API_KEY. ` +
        "Did you forget to provision the Gemini AI integration?",
    );
  }
  // The proxy cannot serve the pinned image/video models, so this is a
  // degraded mode, not a working one. Say so once, loudly, at import — the
  // alternative is a vendor error about a missing endpoint at generation time.
  console.warn(
    `[gemini] No direct Google AI key found in ${directGeminiKeyNames()}. Falling back to the ` +
      "Replit AI Integrations proxy, which CANNOT serve gemini-3-pro-image, " +
      "gemini-omni-flash-preview or gemini-3.5-flash — image generation, layer edits and video " +
      "will fail with \"Endpoint: 'POST /interactions' is not supported\". Set one of those " +
      "secrets and restart the server.",
  );
} else {
  console.info(`[gemini] Using direct Google AI key from ${direct.varName}.`);
}

export const ai = direct
  ? new GoogleGenAI({ apiKey: direct.key })
  : new GoogleGenAI({
      apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
      httpOptions: {
        apiVersion: "",
        baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
      },
    });
