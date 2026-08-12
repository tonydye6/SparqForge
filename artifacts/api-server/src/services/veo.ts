/**
 * The story path · step 5 · the second video model, reached by ROUTING.
 *
 * **Why a second model exists at all.** A shot that pins an END frame needs a
 * model that accepts one, and Omni does not. That is measured, not assumed: on
 * the Interactions API `last_frame`, `lastFrame`, `end_frame` and `final_frame`
 * are each rejected as "Unknown parameter" — as is a nonsense control field,
 * while a request with NO extra field passes parameter validation and fails on
 * content instead. So the rejections are about the field names, and the
 * capability is genuinely absent (probed 2026-08-12).
 *
 * **Why THIS tier.** `veo-3.1-fast-generate-preview` is the only Veo 3.1 tier
 * that accepts BOTH `lastFrame` and `referenceImages`, and references are not
 * optional here — they are how the identity lock and the brand's real mark ride
 * along. Lite is half the price and drops them, which would break the one thing
 * that keeps clips on-model. Standard is 4x for no capability the routing needs.
 * Fast is also $0.10/s, the same rate already paid for Omni, so pinning an end
 * frame costs nothing extra per second.
 *
 * **The request shape was probed, not guessed.** Every field below was confirmed
 * by sending a deliberately WRONG VALUE and reading which error came back: a
 * struct-type complaint means the field exists, an "isn't supported by this
 * model" complaint means it does not. Nothing was generated to find this out.
 *
 * This is a long-running operation: the POST returns an operation name and the
 * video arrives by polling. Unlike the Interactions API, nothing is inline in
 * the first response.
 */
/** The tier the routing targets. Env-overridable for the Settings-level escape. */
export const VEO_MODEL = process.env.VEO_FIRST_LAST_MODEL || "veo-3.1-fast-generate-preview";

/**
 * $/second, 720p, audio included — read off the vendor price list on
 * 2026-08-12 rather than recalled. Same rate as Omni, which is why routing to
 * it does not change what a beat costs per second.
 */
export const VEO_USD_PER_SECOND = Number(process.env.VEO_COST_PER_SECOND_USD) || 0.10;

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta";

/** How long to wait for a clip before giving up. Veo is slower than Omni. */
const TIMEOUT_MS = 6 * 60 * 1000;
const POLL_MS = 5000;

export interface VeoImage {
  buffer: Buffer;
  mimeType?: string;
}

export interface VeoResult {
  videoBuffer: Buffer;
  model: string;
  durationSeconds: number;
  costUsd: number;
  /** True when references had to be dropped to get a render at all. */
  referencesDropped: boolean;
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!key) throw new Error("Veo needs GEMINI_API_KEY, which is not configured on this environment.");
  return key;
}

const asImage = (img: VeoImage) => ({
  bytesBase64Encoded: img.buffer.toString("base64"),
  mimeType: img.mimeType || "image/png",
});

/** The message the API gave, dug out of whatever shape it arrived in. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * The finished video, from whichever field this API version puts it in.
 *
 * Defensive on purpose, and it THROWS rather than returning empty when nothing
 * matches: a caller that got no bytes but no error would write a take pointing
 * at nothing, and the money is already spent by this point.
 */
function extractVideo(done: unknown): { base64?: string; uri?: string } {
  const seen: Array<Record<string, unknown>> = [];
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 6) return;
    seen.push(node as Record<string, unknown>);
    for (const v of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(item => walk(item, depth + 1));
      else walk(v, depth + 1);
    }
  };
  walk(done, 0);
  for (const node of seen) {
    const b64 = node.bytesBase64Encoded ?? node.videoBytes;
    if (typeof b64 === "string" && b64.length > 0) return { base64: b64 };
    const uri = node.uri ?? node.url;
    if (typeof uri === "string" && /^https?:\/\//.test(uri)) return { uri };
  }
  throw new Error("Veo reported success but returned no video, so nothing could be saved.");
}

/**
 * Generate one clip on Veo, optionally pinned at both ends.
 *
 * References are sent when given, and DROPPED WITH A FLAG if the API refuses
 * them — a clip with a weaker identity lock, disclosed, beats no clip at all,
 * and the caller records which it got.
 */
export async function runVeoVideo(params: {
  prompt: string;
  /** The first frame. Required: this path exists to pin frames. */
  firstFrame: VeoImage;
  /** The frame the shot must end on. The whole reason for this model. */
  lastFrame: VeoImage;
  /** Identity references — the subject pin and the brand's real mark. */
  references?: VeoImage[];
  durationSeconds?: number;
  aspectRatio?: string;
}): Promise<VeoResult> {
  const key = apiKey();
  const durationSeconds = params.durationSeconds ?? 6;
  const references = params.references ?? [];

  const instance = (withRefs: boolean): Record<string, unknown> => ({
    prompt: params.prompt,
    image: asImage(params.firstFrame),
    lastFrame: asImage(params.lastFrame),
    ...(withRefs && references.length > 0
      ? { referenceImages: references.map(r => ({ image: asImage(r) })) }
      : {}),
  });

  const start = async (withRefs: boolean): Promise<Response> =>
    fetch(`${API_ROOT}/models/${VEO_MODEL}:predictLongRunning?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [instance(withRefs)],
        parameters: {
          durationSeconds,
          ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
        },
      }),
    });

  let referencesDropped = false;
  let res = await start(references.length > 0);
  if (!res.ok && references.length > 0) {
    /*
     * One retry without references. The probe says this tier accepts them, but
     * the item shape is the least-documented part of the request, and losing
     * the whole clip to a reference the API would not take is the worse
     * outcome. The flag is what stops that being a silent downgrade.
     */
    const first = await errorMessage(res);
    console.warn("Veo refused the reference images; retrying without them", first);
    res = await start(false);
    referencesDropped = true;
  }
  if (!res.ok) throw new Error(`Veo refused the request: ${await errorMessage(res)}`);

  const started = await res.json() as { name?: string };
  if (!started.name) throw new Error("Veo accepted the request but named no operation to poll.");

  const deadline = Date.now() + TIMEOUT_MS;
  let done: unknown = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const pollRes = await fetch(`${API_ROOT}/${started.name}?key=${encodeURIComponent(key)}`);
    if (!pollRes.ok) throw new Error(`Veo's operation could not be read: ${await errorMessage(pollRes)}`);
    const op = await pollRes.json() as { done?: boolean; error?: { message?: string }; response?: unknown };
    if (op.error) throw new Error(`Veo failed: ${op.error.message ?? "no reason given"}`);
    if (op.done) { done = op.response ?? op; break; }
  }
  if (done === null) throw new Error("Veo did not finish in time, so the shot was not made.");

  const video = extractVideo(done);
  const videoBuffer = video.base64
    ? Buffer.from(video.base64, "base64")
    : Buffer.from(await (await fetch(`${video.uri}${video.uri!.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`)).arrayBuffer());

  if (videoBuffer.length === 0) {
    throw new Error("Veo returned an empty video, so nothing could be saved.");
  }

  return {
    videoBuffer,
    model: VEO_MODEL,
    durationSeconds,
    // Billed per second at the rate on the vendor's list, not at a flat guess —
    // the same discipline the TTS estimate had to learn.
    costUsd: Number((durationSeconds * VEO_USD_PER_SECOND).toFixed(4)),
    referencesDropped,
  };
}

/** What a pinned shot would cost, for the price shown before it runs. */
export function estimateVeoCost(durationSeconds: number): number {
  return Number((durationSeconds * VEO_USD_PER_SECOND).toFixed(4));
}
