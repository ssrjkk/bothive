/**
 * Local LLM integration via Ollama.
 *
 * Instead of sending prompts to OpenAI/Claude (costly, rate-limited, traceable),
 * BotHive can use a locally-hosted Ollama instance to generate unique, contextual
 * responses.  This module provides a thin client for the Ollama HTTP API.
 *
 * Ollama must be running locally (default: http://localhost:11434).  The model
 * is configurable per-bot via `bot.config.aiModel`.
 */

export interface OllamaConfig {
  /** Ollama base URL. Default: http://localhost:11434 */
  baseUrl: string;
  /** Default model to use if bot.config.aiModel is not set. */
  defaultModel: string;
  /** Request timeout (ms). Default 30000. */
  timeoutMs: number;
}

export const DEFAULT_OLLAMA_CONFIG: OllamaConfig = {
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  defaultModel: process.env.OLLAMA_DEFAULT_MODEL ?? 'qwen2.5:7b',
  timeoutMs: 30_000,
};

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOptions {
  model?: string;
  /** Temperature (0-1). Higher = more creative. Default 0.7. */
  temperature?: number;
  /** Max tokens to generate. Default 256. */
  maxTokens?: number;
  /** System prompt prepended to the conversation. */
  systemPrompt?: string;
}

export interface GenerateResult {
  response: string;
  model: string;
  /** Token counts if available. */
  eval?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Generates a contextual response from the local LLM.
 *
 * @param messages - Recent conversation context (last 5-10 messages).
 * @param options - Generation options.
 * @param config - Ollama connection config.
 */
export async function generateResponse(
  messages: ChatMessage[],
  options: GenerateOptions = {},
  config: OllamaConfig = DEFAULT_OLLAMA_CONFIG,
): Promise<GenerateResult> {
  const model = options.model ?? config.defaultModel;
  const temperature = options.temperature ?? 0.7;

  const formattedMessages = [
    ...(options.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
    ...messages,
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const resp = await fetch(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: false,
        options: {
          temperature,
          num_predict: options.maxTokens ?? 256,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown error');
      throw new Error(`Ollama API error ${resp.status}: ${text}`);
    }

    const data = (await resp.json()) as {
      message?: { content?: string };
      model?: string;
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      response: data.message?.content ?? '',
      model: data.model ?? model,
      eval: data.eval_count
        ? {
            promptTokens: data.prompt_eval_count ?? 0,
            completionTokens: data.eval_count,
          }
        : undefined,
    };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${config.timeoutMs}ms`, {
        cause: err,
      });
    }
    throw err;
  }
}

/**
 * Checks whether the Ollama server is reachable and has the requested model.
 */
export async function checkOllamaHealth(
  config: OllamaConfig = DEFAULT_OLLAMA_CONFIG,
): Promise<{ reachable: boolean; models: string[] }> {
  try {
    const resp = await fetch(`${config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return { reachable: false, models: [] };
    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    return {
      reachable: true,
      models: (data.models ?? []).map((m) => m.name),
    };
  } catch {
    return { reachable: false, models: [] };
  }
}

/**
 * Pre-loads a model into memory (warm-up).  Without this the first request
 * to a cold model can take 30+ seconds while the model loads from disk.
 */
export async function preloadModel(
  model: string,
  config: OllamaConfig = DEFAULT_OLLAMA_CONFIG,
): Promise<void> {
  const resp = await fetch(`${config.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: '5m', prompt: '' }),
    signal: AbortSignal.timeout(120_000), // 2 min for large models
  });
  if (!resp.ok) {
    throw new Error(`Failed to preload model ${model}: ${resp.status}`);
  }
}
