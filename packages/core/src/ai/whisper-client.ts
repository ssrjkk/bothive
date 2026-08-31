/**
 * Local speech-to-text via Whisper (Ollama-hosted or standalone whisper.cpp).
 *
 * Voice messages are a rich interaction channel but transcribing them through
 * cloud APIs (Google, OpenAI) leaks user data and costs money.  This module
 * provides a thin client for a locally-hosted Whisper-compatible API.
 *
 * Two backends are supported:
 *  1. **Ollama whisper plugin** — if the Ollama server has a whisper model loaded.
 *  2. **Standalone whisper.cpp server** — a lightweight HTTP wrapper around
 *     whisper.cpp (default: http://localhost:8080).
 */

export interface WhisperConfig {
  /** Backend type. Default: 'ollama' */
  backend: 'ollama' | 'whisper-cpp';
  /** Ollama base URL (for ollama backend). Default: http://localhost:11434 */
  ollamaBaseUrl: string;
  /** whisper.cpp server URL (for whisper-cpp backend). Default: http://localhost:8080 */
  whisperCppUrl: string;
  /** Model name for Ollama whisper. Default: 'whisper' */
  ollamaModel: string;
  /** Language hint (ISO 639-1). Default: auto-detect. */
  language?: string;
  /** Request timeout (ms). Default 60000 (voice messages can be long). */
  timeoutMs: number;
}

export const DEFAULT_WHISPER_CONFIG: WhisperConfig = {
  backend: (process.env.WHISPER_BACKEND as 'ollama' | 'whisper-cpp') ?? 'ollama',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  whisperCppUrl: process.env.WHISPER_CPP_URL ?? 'http://localhost:8080',
  ollamaModel: process.env.WHISPER_MODEL ?? 'whisper',
  timeoutMs: 60_000,
};

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Transcribes an audio buffer (voice message) to text.
 *
 * @param audio - Raw audio data (OGG/Opus from Telegram, WebM from browser, etc.)
 * @param mimeType - MIME type of the audio (e.g. 'audio/ogg').
 * @param config - Whisper backend config.
 */
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  config: WhisperConfig = DEFAULT_WHISPER_CONFIG,
): Promise<TranscriptionResult> {
  if (config.backend === 'ollama') {
    return transcribeViaOllama(audio, mimeType, config);
  }
  return transcribeViaWhisperCpp(audio, mimeType, config);
}

async function transcribeViaOllama(
  audio: Buffer,
  mimeType: string,
  config: WhisperConfig,
): Promise<TranscriptionResult> {
  const base64 = audio.toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const resp = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt: 'Transcribe this audio to text.',
        images: [base64],
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`Ollama whisper error: ${resp.status}`);
    }

    const data = (await resp.json()) as { response?: string };
    return {
      text: data.response ?? '',
      language: config.language,
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function transcribeViaWhisperCpp(
  audio: Buffer,
  mimeType: string,
  config: WhisperConfig,
): Promise<TranscriptionResult> {
  const formData = new FormData();
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('webm') ? 'webm' : 'wav';
  formData.append('file', new Blob([new Uint8Array(audio)]), `audio.${ext}`);
  if (config.language) {
    formData.append('language', config.language);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const resp = await fetch(`${config.whisperCppUrl}/inference`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`whisper.cpp error: ${resp.status}`);
    }

    const data = (await resp.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };

    return {
      text: data.text ?? '',
      language: data.language ?? config.language,
      duration: data.duration,
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Checks whether the Whisper backend is reachable.
 */
export async function checkWhisperHealth(
  config: WhisperConfig = DEFAULT_WHISPER_CONFIG,
): Promise<boolean> {
  try {
    const url =
      config.backend === 'ollama'
        ? `${config.ollamaBaseUrl}/api/tags`
        : `${config.whisperCppUrl}/health`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}
