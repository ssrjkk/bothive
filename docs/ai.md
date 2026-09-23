# Local AI backends

BotHive can use **locally-hosted** AI models instead of cloud APIs (OpenAI, Google, etc.) for two capabilities: LLM-generated responses and voice-message transcription. No data leaves the host — everything runs on your hardware.

Both backends are optional. Without configuration the modules are no-ops (no network, no errors).

## LLM responses (Ollama)

Generate contextual replies from a local LLM via the [Ollama](https://ollama.com) HTTP API. Useful for auto-responses in scripts — a bot can call `generateResponse()` with the last few chat messages and get a unique, in-character reply.

| Env var                | Default                  | Description                           |
| ---------------------- | ------------------------ | ------------------------------------- |
| `OLLAMA_BASE_URL`      | `http://localhost:11434` | Ollama server URL                     |
| `OLLAMA_DEFAULT_MODEL` | `qwen2.5:7b`             | model used when a bot has no override |

Per-bot model selection is available via `bot.config.aiModel`. Temperature, max tokens and system prompt are configurable per call.

The first request to a cold model can take 30+ seconds while it loads from disk. Use `preloadModel()` to warm it up at startup.

## Voice transcription (Whisper)

Transcribe voice messages (Telegram OGG/Opus, browser WebM, etc.) to text. Two backends are supported:

| Backend        | Env var                       | Default                  |
| -------------- | ----------------------------- | ------------------------ |
| Ollama whisper | `WHISPER_BACKEND=ollama`      | `http://localhost:11434` |
| whisper.cpp    | `WHISPER_BACKEND=whisper-cpp` | `http://localhost:8080`  |

| Env var           | Default                  | Description                         |
| ----------------- | ------------------------ | ----------------------------------- |
| `WHISPER_BACKEND` | `ollama`                 | which backend to use                |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama URL (ollama backend)         |
| `WHISPER_CPP_URL` | `http://localhost:8080`  | whisper.cpp server URL              |
| `WHISPER_MODEL`   | `whisper`                | Ollama model name for transcription |

The `language` option hints at ISO 639-1 auto-detection; omit for automatic detection.

## Setup

1. Install Ollama: `curl -fsSL https://ollama.com/install.sh | sh`
2. Pull a model: `ollama pull qwen2.5:7b`
3. Set the env vars in `.env` (defaults work for a local Ollama on the same host)
4. For whisper.cpp, build and run the server separately (see [whisper.cpp](https://github.com/ggerganov/whisper.cpp/tree/master/examples/server))

## Health checks

Both modules expose health-check functions (`checkOllamaHealth`, `checkWhisperHealth`) that verify the backend is reachable and return available models. The API can surface these via a health endpoint for the dashboard.
