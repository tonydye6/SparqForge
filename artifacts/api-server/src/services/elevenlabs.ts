const ELEVENLABS_API_KEY = process.env.SparqMake_ElevenLabs_API_Key;
const BASE_URL = "https://api.elevenlabs.io/v1";

export type AudioType = "music" | "sfx";

export interface AudioGenerationResult {
  audioBuffer: Buffer;
  mimeType: string;
  type: AudioType;
}

export async function generateMusic(prompt: string, durationSeconds: number = 8, signal?: AbortSignal): Promise<AudioGenerationResult> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs API key not configured");
  }

  const response = await fetch(`${BASE_URL}/text-to-music`, {
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

export function estimateElevenLabsCost(): number {
  return 0.15;
}
