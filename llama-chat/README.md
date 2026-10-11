# Llama API test chat

A bare-bones black-and-white chat page for checking whether the Meta Llama API works. A small Node server (no dependencies) serves the page and proxies `/api/chat` to the Llama API with streaming, so the API key stays on the server.

## Run

Requires Node 18 or newer.

```bash
export LLAMA_API_KEY=...   # Meta Llama API key
node llama-chat/server.js
```

Then open http://localhost:3000.

Optional environment variables:

- `LLAMA_BASE_URL` (default `https://api.llama.com/v1`)
- `LLAMA_MODEL` (default: the first model from `GET /models` if the key works, otherwise `Llama-4-Maverick-17B-128E-Instruct-FP8`)
- `PORT` (default `3000`)

API errors are shown in the chat with their HTTP status code and message.
