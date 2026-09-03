import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateResponse,
  checkOllamaHealth,
  preloadModel,
  DEFAULT_OLLAMA_CONFIG,
} from '../ai/ollama-client.js';
import {
  transcribeAudio,
  checkWhisperHealth,
  DEFAULT_WHISPER_CONFIG,
} from '../ai/whisper-client.js';

function stubFetch(
  impl: (url: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<unknown>,
) {
  const mock = vi.fn(impl) as unknown as typeof fetch;
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('ollama-client', () => {
  const cfg = { baseUrl: 'http://ollama:11434', defaultModel: 'qwen2.5:7b', timeoutMs: 1000 };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('generateResponse posts to /api/chat and returns the model output', async () => {
    const fetchMock = stubFetch(async (url, init) => {
      expect(String(url)).toBe('http://ollama:11434/api/chat');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('qwen2.5:7b');
      expect(body.messages[0].role).toBe('user');
      return {
        ok: true,
        json: async () => ({
          message: { content: 'hello from ollama' },
          model: 'qwen2.5:7b',
          eval_count: 10,
        }),
      };
    });

    const result = await generateResponse([{ role: 'user', content: 'hi' }], {}, cfg);
    expect(result.response).toBe('hello from ollama');
    expect(result.model).toBe('qwen2.5:7b');
    expect(result.eval).toMatchObject({ promptTokens: 0, completionTokens: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prepends a system prompt when provided', async () => {
    const fetchMock = stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.messages[0]).toMatchObject({ role: 'system', content: 'be funny' });
      return { ok: true, json: async () => ({ message: { content: 'ok' } }) };
    });
    await generateResponse([{ role: 'user', content: 'joke' }], { systemPrompt: 'be funny' }, cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error on an Ollama API failure', async () => {
    stubFetch(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    await expect(generateResponse([{ role: 'user', content: 'x' }], {}, cfg)).rejects.toThrow(
      /500: boom/,
    );
  });

  it('throws a timeout error when the request aborts', async () => {
    stubFetch(async () => {
      throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    });
    await expect(generateResponse([{ role: 'user', content: 'x' }], {}, cfg)).rejects.toThrow(
      /timed out/,
    );
  });

  it('checkOllamaHealth lists available models', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'qwen2.5:7b' }, { name: 'llama3:8b' }] }),
    }));
    const health = await checkOllamaHealth(cfg);
    expect(health).toMatchObject({ reachable: true, models: ['qwen2.5:7b', 'llama3:8b'] });
  });

  it('checkOllamaHealth reports unreachable on network error', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    const health = await checkOllamaHealth(cfg);
    expect(health.reachable).toBe(false);
  });

  it('preloadModel warms a model via /api/generate', async () => {
    const fetchMock = stubFetch(async (url, init) => {
      expect(String(url)).toBe('http://ollama:11434/api/generate');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('llama3:8b');
      return { ok: true };
    });
    await preloadModel('llama3:8b', cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preloadModel throws when the model cannot be loaded', async () => {
    stubFetch(async () => ({ ok: false, status: 404 }));
    await expect(preloadModel('nope', cfg)).rejects.toThrow(/Failed to preload model nope: 404/);
  });
});

describe('whisper-client', () => {
  const audio = Buffer.from('fake-ogg-data');
  const cfg = {
    ...DEFAULT_WHISPER_CONFIG,
    backend: 'whisper-cpp' as const,
    whisperCppUrl: 'http://whisper:8080',
    ollamaBaseUrl: 'http://ollama:11434',
    ollamaModel: 'whisper',
    timeoutMs: 1000,
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('transcribes via whisper.cpp using multipart form data', async () => {
    const fetchMock = stubFetch(async (url, init) => {
      expect(String(url)).toBe('http://whisper:8080/inference');
      expect(init).toBeTruthy();
      return {
        ok: true,
        json: async () => ({ text: 'hello world', language: 'en', duration: 2.1 }),
      };
    });
    const result = await transcribeAudio(audio, 'audio/ogg', cfg);
    expect(result).toMatchObject({ text: 'hello world', language: 'en', duration: 2.1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('transcribes via the ollama backend when configured', async () => {
    const ollamaCfg = { ...cfg, backend: 'ollama' as const, ollamaBaseUrl: 'http://ollama:11434' };
    const fetchMock = stubFetch(async (url, init) => {
      expect(String(url)).toBe('http://ollama:11434/api/generate');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('whisper');
      expect(body.images[0]).toBeDefined();
      return { ok: true, json: async () => ({ response: 'transcribed text' }) };
    });
    const result = await transcribeAudio(audio, 'audio/ogg', ollamaCfg);
    expect(result.text).toBe('transcribed text');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on whisper.cpp failure', async () => {
    stubFetch(async () => ({ ok: false, status: 500 }));
    await expect(transcribeAudio(audio, 'audio/ogg', cfg)).rejects.toThrow(/500/);
  });

  it('checkWhisperHealth pings the backend health endpoint', async () => {
    const fetchMock = stubFetch(async (url) => {
      expect(String(url)).toBe('http://whisper:8080/health');
      return { ok: true };
    });
    const ok = await checkWhisperHealth(cfg);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('checkWhisperHealth reports unreachable on error', async () => {
    stubFetch(async () => {
      throw new Error('down');
    });
    expect(await checkWhisperHealth(cfg)).toBe(false);
  });
});
