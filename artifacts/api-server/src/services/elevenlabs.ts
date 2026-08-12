/*
 * Both names, new first. The product rename (SparqForge → SparqMake) never
 * reached the Replit secret, so the code read a key that did not exist and
 * every ElevenLabs call has failed "not configured" since — found when the
 * first voice route went live (2026-08-12). The fallback keeps whichever
 * name the environment actually has.
 */
const ELEVENLABS_API_KEY =
  process.env.SparqMake_ElevenLabs_API_Key ?? process.env.SparqForge_ElevenLabs_API_Key;
const BASE_URL = "https://api.elevenlabs.io/v1";

export type AudioType = "music" | "sfx";

export interface AudioGenerationResult {
  audioBuffer: Buffer;
  mimeType: string;
  type: AudioType;
}

export async function generateMusic(prompt: string, durationSeconds: number = 10, signal?: AbortSignal): Promise<AudioGenerationResult> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs API key not configured");
  }

  /*
   * POST /v1/music with music_length_ms — the real Music API. The original
   * Phase 9 code guessed "/text-to-music" with duration_seconds and 404'd on
   * its first live call (2026-08-12): the dead API key had hidden that this
   * function never worked. The API's floor is 10 seconds, so shorter cuts get
   * a 10s bed the render trims.
   */
  const lengthMs = Math.min(300_000, Math.max(10_000, Math.round(durationSeconds * 1000)));
  const response = await fetch(`${BASE_URL}/music`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      music_length_ms: lengthMs,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs music generation failed: ${response.status} ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  return {
    audioBuffer,
    mimeType: "audio/mpeg",
    type: "music",
  };
}

export async function generateSFX(prompt: string, durationSeconds: number = 3, signal?: AbortSignal): Promise<AudioGenerationResult> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs API key not configured");
  }

  const response = await fetch(`${BASE_URL}/sound-generation`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: durationSeconds,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs SFX generation failed: ${response.status} ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  return {
    audioBuffer,
    mimeType: "audio/mpeg",
    type: "sfx",
  };
}

/* ------------------------------------------------------------------------- *
 * Phase 9 item 4 · the narrator.
 *
 * Music and SFX have been here since v1; a VOICE never has, which is why
 * `brands.narratorVoiceId` and `narratorDescription` were added by M1 and then
 * read by nothing. This is what reads them.
 * ------------------------------------------------------------------------- */

/**
 * The model. `eleven_multilingual_v2` rather than the faster turbo tiers:
 * a brand narrator is rendered once and then lives in every cut of that post,
 * so quality outranks latency here in a way it would not for a live assistant.
 */
const TTS_MODEL = "eleven_multilingual_v2";

export interface SpeechResult {
  audioBuffer: Buffer;
  mimeType: string;
  voiceId: string;
}

export interface Voice {
  voiceId: string;
  name: string;
  /** ElevenLabs' own blurb. Shown when picking, never sent to a model. */
  description: string | null;
  previewUrl: string | null;
}

/**
 * Speak a script in the brand's narrator voice.
 *
 * `voiceId` is required rather than defaulted. A brand with no narrator set
 * should be told to choose one, not quietly given a stranger's voice that then
 * ships in a post: the brand contract covers sound too, and Tony agreed that
 * "100%" (doc 24 §3).
 */
export async function generateSpeech(params: {
  script: string;
  voiceId: string;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  const { script, voiceId, signal } = params;
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs API key not configured");
  }
  if (!voiceId) {
    throw new Error("This brand has no narrator voice set, so there is nothing to speak the script in.");
  }
  const text = script.trim();
  if (!text) {
    throw new Error("There is no script to speak.");
  }

  const response = await fetch(`${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: TTS_MODEL }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    // 401 here means the key, 404 means the voice. Saying which saves the next
    // person the round trip of checking both.
    const hint =
      response.status === 404 ? " (that voice id does not exist on this account)"
      : response.status === 401 ? " (the API key was rejected)"
      : "";
    throw new Error(`ElevenLabs speech generation failed: ${response.status}${hint} ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return { audioBuffer, mimeType: "audio/mpeg", voiceId };
}

/** The voices this account can use, for the brand record's narrator picker. */
export async function listVoices(signal?: AbortSignal): Promise<Voice[]> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs API key not configured");
  }
  const response = await fetch(`${BASE_URL}/voices`, {
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    signal,
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs voice list failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {
    voices?: Array<{ voice_id?: string; name?: string; description?: string | null; preview_url?: string | null }>;
  };
  return (body.voices ?? [])
    .filter((v): v is { voice_id: string; name?: string } => typeof v.voice_id === "string")
    .map(v => ({
      voiceId: v.voice_id,
      name: v.name ?? v.voice_id,
      description: (v as { description?: string | null }).description ?? null,
      previewUrl: (v as { preview_url?: string | null }).preview_url ?? null,
    }));
}

/**
 * @deprecated The flat figure the legacy video path reserves with. The
 * per-unit estimators below replace it — a flat price is the same stale-label
 * class the motion "≈$1.70" was (doc 41 §5).
 */
export function estimateElevenLabsCost(): number {
  return 0.15;
}

/*
 * Per-unit estimates, stated as estimates.
 *
 * These are ballpark rates for the creator tier, written down so the ledger
 * meters by what a call actually used (characters, seconds) instead of one
 * flat number for a 40-character hook and a 2000-character caption alike.
 * Like VIDEO_COST_PER_SECOND_USD before them, they should be corrected from a
 * live probe of the account's real plan — the shape is what matters here.
 */
const TTS_USD_PER_1K_CHARS = 0.15;
const MUSIC_USD_PER_SECOND = 0.02;
const SFX_USD_PER_GENERATION = 0.08;

export function estimateTtsCost(characters: number): number {
  return Math.max(0.01, (characters / 1000) * TTS_USD_PER_1K_CHARS);
}

export function estimateMusicCost(seconds: number): number {
  return Math.max(0.1, seconds * MUSIC_USD_PER_SECOND);
}

export function estimateSfxCost(): number {
  return SFX_USD_PER_GENERATION;
}

/**
 * Duration from bytes, assuming the 128kbps CBR mp3 ElevenLabs returns by
 * default (16000 bytes per second). An estimate — the mixer treats a null
 * duration as "cannot duck yet", so a close estimate beats a refusal, and the
 * render measures the real file.
 */
export function estimateMp3DurationSeconds(bytes: number): number {
  return Math.max(0.1, bytes / 16000);
}
