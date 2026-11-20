# chat-app

Single-page AI chat app (HTML, CSS, vanilla JS, no build step). It is built section by section. So far it has:

- **Layout:** `index.html`, `styles.css` and `app.js`. Design values live in CSS variables at the top of `styles.css`.
- **Conversation flow:** in `app.js`.
  - Chats are saved in `localStorage` under the key `chat-app:v1`. Each chat can be renamed, deleted (after a confirm) and searched; search matches titles and message text.
  - Editing a user message or regenerating the last reply adds a new branch. A ‹ 1/2 › switcher moves between versions, so the original stays reachable.
  - Stop keeps the partial answer. Every response and every fenced code block has a copy button.
  - While a reply streams, the view follows it unless you scroll up. A "Jump to latest" button brings you back.
  - Suggestion chips appear only when the API returns them.
- **Model integration:** `api.js`.

## Running it

ES modules don't load from `file://`, so serve the folder over HTTP and open the page:

```sh
cd chat-app && python3 -m http.server 8000   # then open http://localhost:8000
```

`api.js` is an ES module with no dependencies. Load it with `<script type="module">` and `import { sendToModel } from "./api.js"`.

## Setting the endpoint and key

Edit the `CONFIG` block at the top of `api.js`. Fill in the lines marked `>>> PLACEHOLDER`:

```js
ENDPOINT: "https://YOUR-PROVIDER.example.com/v1/chat/completions", // full chat-completions URL
API_KEY:  "",                                                      // leave empty; see below
MODEL:    "YOUR_MODEL_NAME",
```

Any OpenAI-compatible `/chat/completions` endpoint works. **Never commit a real key in `api.js`.** The key should come from a local server that reads it from the environment and adds it to requests. Point `ENDPOINT` at that server and leave `API_KEY` empty. When `API_KEY` is empty, no `Authorization` header is sent. You can also set these at runtime with `configure({ ENDPOINT, API_KEY, MODEL })`.

## Mock mode

Mock mode returns fake streamed text with no network calls. It is **on by default**. To toggle it, use any of these:

- Set `CONFIG.MOCK` in `api.js` to `true` or `false`.
- Add `?mock=1` or `?mock=0` to the page URL.
- Call `configure({ MOCK: false })` at runtime.

To test error states in the UI, set `MOCK_ERROR` to a code such as `"rate_limit"`, and adjust `MOCK_DELAY_MS` to control the token speed.

## Function contract

```js
const result = await sendToModel(messages, { signal, onToken });
```

- **`messages`** is an array of `{ role, content }` objects in OpenAI format. They are sent unchanged.
- **`signal`** (optional) is an `AbortSignal`. When the request is aborted, the call **resolves** (it does not reject) with `aborted: true` and the partial text received so far.
- **`onToken(token, fullText)`** (optional) is called for each new piece of text. A non-streamed reply calls it once with the whole text.
- **The return value** has this shape: `{ text, aborted, streamed, finishReason, sources, suggestions }`.
  - `sources` contains any citation fields the API returned (`citations`, `search_results`, `sources`, and `annotations`), passed through untouched, or `null` if there were none.
  - `suggestions` is the response's top-level `suggestions` field (follow-up prompts), passed through untouched, or `null`. The UI shows its string items as chips. Mock mode returns two.
- **Streaming:** the request asks for `stream: true`. If the server responds with JSON instead of Server-Sent Events, the response is read as a normal reply. Set `STREAM: false` to never request streaming.
- **Errors:** the function throws `ModelError` with these fields: `code`, `status`, `retryAfter`, and `partialText`. The possible values of `code` are:

| `code` | Meaning |
|---|---|
| `network` | The request failed or the connection dropped. |
| `timeout` | No data arrived within `TIMEOUT_MS`, either before the first byte or between stream chunks. |
| `rate_limit` | HTTP 429. `retryAfter` is in seconds, when the server provides it. |
| `http` | Any other non-2xx response; see `status`. Also used for in-stream error events. |
| `empty_response` | The request succeeded but contained no text. |
| `bad_response` | The response body could not be parsed. |
| `config` | The arguments were invalid. |

The model is treated as a black box. There is no prompt engineering, no retrying for better answers, and no filtering of output.
