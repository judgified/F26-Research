# Chat API test

A bare-bones black-and-white chat page for checking whether an OpenAI-compatible chat API (Ollama Cloud, local Ollama, or the Meta Llama API) works. A small Node server (no dependencies) serves the page and proxies `/api/chat` to the API with streaming, so the API key stays on the server.

Requires Node 18 or newer. After starting the server, open http://localhost:3000.

## Ollama Cloud (default)

Create a key at https://ollama.com/settings/keys, then:

```bash
export OLLAMA_API_KEY=...
node llama-chat/server.js
```

This uses `https://ollama.com/v1` with `Authorization: Bearer $OLLAMA_API_KEY`. The default model is `gpt-oss:20b`, since Ollama Cloud has no Llama models right now. For other names, see `curl https://ollama.com/v1/models`.

## Local Ollama

With Ollama running locally and a model pulled (for example `ollama pull llama3.2`):

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1 OLLAMA_MODEL=llama3.2 node llama-chat/server.js
```

No key is needed. If `OLLAMA_MODEL` is unset, the server uses the first model the local server lists.

## Environment variables

- `OLLAMA_API_KEY`: API key, sent as a Bearer token. Falls back to `LLAMA_API_KEY`. If neither is set, no `Authorization` header is sent.
- `OLLAMA_BASE_URL`: default `https://ollama.com/v1`. Falls back to `LLAMA_BASE_URL`. Use `https://api.llama.com/v1` for the Meta Llama API.
- `OLLAMA_MODEL`: falls back to `LLAMA_MODEL`. If neither is set, the server calls `GET /models` at startup. It keeps `gpt-oss:20b` if that model is listed and otherwise uses the first listed model. If the list call fails, it uses `gpt-oss:20b`.
- `PORT`: default `3000`.

API errors are shown in the chat with their HTTP status code and message.
