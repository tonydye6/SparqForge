export { ai } from "./client";
export { generateImage } from "./image";
export { batchProcess, batchProcessWithSSE, isRateLimitError, type BatchOptions } from "./batch";
export {
  DIRECT_GEMINI_KEY_VARS,
  directGeminiKeyNames,
  isUsableApiKey,
  resolveDirectGeminiKey,
  type ResolvedGeminiKey,
} from "./api-key.js";  // also available as @workspace/integrations-gemini-ai/api-key, which does NOT construct the client
