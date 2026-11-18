/**
 * api.js: the single integration point between the chat app and a model.
 *
 * Everything the app sends to or receives from a model goes through
 * `sendToModel(messages, { signal, onToken })`. The model is a black box:
 * messages go out exactly as given, and text comes back exactly as received.
 * There is no prompt engineering, no quality-driven retries, and no filtering.
 *
 * Loaded as an ES module: <script type="module" src="api.js"></script>
 * No dependencies and no build step.
 */

/* ========================================================================== *
 *  CONFIGURATION: edit this block to connect a real API                     *
 * ========================================================================== */

export const CONFIG = {
  // >>> PLACEHOLDER: full URL of an OpenAI-compatible chat completions endpoint.
  //     Examples: "https://api.openai.com/v1/chat/completions"
  //               "https://ollama.com/v1/chat/completions"
  ENDPOINT: "https://YOUR-PROVIDER.example.com/v1/chat/completions",

  // >>> API key, sent as "Authorization: Bearer <key>" when non-empty.
  //     Never commit a real key here. The key should come from a local server
  //     that reads it from the environment, so leave this empty when using one.
  API_KEY: "",

  // >>> PLACEHOLDER: model name as the provider expects it.
  MODEL: "YOUR_MODEL_NAME",

  // Mock mode: true = fake streamed replies with no network calls.
  // Can also be overridden in the browser with ?mock=1 / ?mock=0 in the URL.
  MOCK: true,

  // Ask the server to stream (SSE). If it answers with plain JSON instead,
  // the response is handled as a normal, non-streamed reply automatically.
  STREAM: true,

  // Abort with a "timeout" error if no data arrives for this many ms
  // (measured before the first byte and between stream chunks).
  TIMEOUT_MS: 60000,

  // Mock-only knobs, for exercising the UI.
  MOCK_DELAY_MS: 40,   // delay between fake tokens
  MOCK_ERROR: null,    // e.g. "rate_limit", "network", "timeout", "http", "empty_response"
};

// URL override for mock mode (browser only): ?mock=1 or ?mock=0
if (typeof location !== "undefined") {
  const flag = new URLSearchParams(location.search).get("mock");
  if (flag === "1" || flag === "true") CONFIG.MOCK = true;
  if (flag === "0" || flag === "false") CONFIG.MOCK = false;
}

/** Merge settings into CONFIG at runtime, e.g. configure({ MOCK: false }). */
export function configure(overrides) {
  Object.assign(CONFIG, overrides);
  return CONFIG;
}

/* ========================================================================== *
 *  ERRORS                                                                    *
 * ========================================================================== */

/**
 * The only error type sendToModel throws. Inspect `code` to choose a message:
 *   "network"        request could not be sent or the connection dropped
 *   "timeout"        no data within CONFIG.TIMEOUT_MS
 *   "rate_limit"     HTTP 429 (see `retryAfter`, in seconds, if the server sent it)
 *   "http"           any other non-2xx status (see `status`)
 *   "empty_response" the request succeeded but contained no text
 *   "bad_response"   the body could not be parsed as a chat completion
 *   "config"         invalid arguments or configuration
 * `partialText` holds any text received before the failure.
 */
export class ModelError extends Error {
  constructor(code, message, { status = null, retryAfter = null, partialText = "", cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ModelError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.partialText = partialText;
  }
}

/* ========================================================================== *
 *  PUBLIC API                                                                *
 * ========================================================================== */

/**
 * Send a conversation to the model.
 *
 * @param {Array<{role: string, content: string}>} messages
 *        OpenAI-style messages, sent unchanged.
 * @param {object}       [opts]
 * @param {AbortSignal}  [opts.signal]  Abort the request. Partial text is kept.
 * @param {(token: string, fullText: string) => void} [opts.onToken]
 *        Called for each new piece of text. Non-streamed replies call it once
 *        with the whole text.
 * @returns {Promise<{text: string, aborted: boolean, streamed: boolean,
 *                    finishReason: string|null, sources: object|null}>}
 *        On abort the promise resolves with `aborted: true` and the partial
 *        text received so far, without rejecting. `sources` contains any
 *        citation fields the API returned, unmodified, or null.
 * @throws {ModelError}
 */
export async function sendToModel(messages, { signal, onToken } = {}) {
  if (!Array.isArray(messages)) {
    throw new ModelError("config", "messages must be an array");
  }
  const emit = typeof onToken === "function" ? onToken : () => {};
  return CONFIG.MOCK
    ? mockSend(messages, signal, emit)
    : realSend(messages, signal, emit);
}

/* ========================================================================== *
 *  REAL MODE: OpenAI-compatible HTTP                                         *
 * ========================================================================== */

async function realSend(messages, signal, emit) {
  const result = { text: "", aborted: false, streamed: false, finishReason: null, sources: null };
  if (signal?.aborted) return { ...result, aborted: true };

  // One controller for both user aborts and the inactivity timeout.
  const controller = new AbortController();
  let timedOut = false;
  let timer = null;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, CONFIG.TIMEOUT_MS);
  };
  const onUserAbort = () => controller.abort();
  signal?.addEventListener("abort", onUserAbort, { once: true });

  const headers = { "Content-Type": "application/json" };
  if (CONFIG.API_KEY) headers.Authorization = `Bearer ${CONFIG.API_KEY}`;

  try {
    resetTimer();
    let res;
    try {
      res = await fetch(CONFIG.ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: CONFIG.MODEL, messages, stream: CONFIG.STREAM }),
        signal: controller.signal,
      });
    } catch (err) {
      throw err?.name === "AbortError" ? err : new ModelError("network", `Network error: ${err?.message || err}`, { cause: err });
    }

    if (!res.ok) throw await httpError(res);

    const type = res.headers.get("content-type") || "";
    if (type.includes("text/event-stream") && res.body) {
      result.streamed = true;
      await readStream(res.body, result, emit, resetTimer);
    } else {
      // Fallback: the server sent an ordinary JSON completion.
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch (err) {
        throw new ModelError("bad_response", "Response was not valid JSON", { cause: err });
      }
      const choice = data?.choices?.[0];
      result.text = typeof choice?.message?.content === "string" ? choice.message.content : "";
      result.finishReason = choice?.finish_reason ?? null;
      result.sources = collectSources(data, choice?.message?.annotations);
      if (result.text) emit(result.text, result.text);
    }

    if (!result.text) {
      throw new ModelError("empty_response", "The model returned an empty response");
    }
    return result;
  } catch (err) {
    if (signal?.aborted) return { ...result, aborted: true };
    if (timedOut) {
      throw new ModelError("timeout", `No response within ${CONFIG.TIMEOUT_MS} ms`, { partialText: result.text });
    }
    if (err instanceof ModelError) {
      err.partialText ||= result.text;
      throw err;
    }
    throw new ModelError("network", `Connection failed: ${err?.message || err}`, { partialText: result.text, cause: err });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onUserAbort);
  }
}

/** Build a ModelError from a non-2xx response, using the server's message when present. */
async function httpError(res) {
  let detail = "";
  try {
    const body = await res.text();
    try { detail = JSON.parse(body)?.error?.message || body; } catch { detail = body; }
  } catch { /* body unreadable; status alone will do */ }
  detail = String(detail).slice(0, 500);

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after")) || null;
    return new ModelError("rate_limit", `Rate limited (429)${detail ? `: ${detail}` : ""}`, { status: 429, retryAfter });
  }
  return new ModelError("http", `HTTP ${res.status}${detail ? `: ${detail}` : ""}`, { status: res.status });
}

/**
 * Parse an OpenAI-style SSE stream ("data: {...}" lines ending with
 * "data: [DONE]"), appending text to `result` as it arrives.
 */
async function readStream(body, result, emit, onActivity) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const annotations = [];
  let topLevel = {};
  let buffer = "";

  const handleLine = (line) => {
    if (!line.startsWith("data:")) return false;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return true;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return false; } // skip malformed chunk
    if (chunk.error) {
      throw new ModelError("http", `Stream error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
    }
    const choice = chunk.choices?.[0];
    const token = choice?.delta?.content;
    if (typeof token === "string" && token) {
      result.text += token;
      emit(token, result.text);
    }
    if (Array.isArray(choice?.delta?.annotations)) annotations.push(...choice.delta.annotations);
    if (choice?.finish_reason) result.finishReason = choice.finish_reason;
    topLevel = { ...topLevel, ...pickSourceFields(chunk) };
    return false;
  };

  try {
    let done = false;
    while (!done) {
      const { value, done: ended } = await reader.read();
      onActivity();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) if (handleLine(line)) { done = true; break; }
    }
    if (!done && buffer) handleLine(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
  result.sources = collectSources(topLevel, annotations);
}

/* ========================================================================== *
 *  SOURCES / CITATIONS: passed through unmodified                            *
 * ========================================================================== */

// Field names providers commonly use for citations on the top-level response.
const SOURCE_FIELDS = ["citations", "search_results", "sources"];

function pickSourceFields(obj) {
  const out = {};
  for (const key of SOURCE_FIELDS) if (obj?.[key] != null) out[key] = obj[key];
  return out;
}

function collectSources(topLevel, annotations) {
  const out = pickSourceFields(topLevel);
  if (Array.isArray(annotations) && annotations.length) out.annotations = annotations;
  return Object.keys(out).length ? out : null;
}

/* ========================================================================== *
 *  MOCK MODE: fake streamed text, no network                                 *
 * ========================================================================== */

async function mockSend(messages, signal, emit) {
  const result = { text: "", aborted: false, streamed: true, finishReason: null, sources: null };
  const last = [...messages].reverse().find((m) => m.role === "user");
  const prompt = typeof last?.content === "string" ? last.content : "";
  const reply =
    `This is a mock reply (mock mode is on). You said: "${prompt.slice(0, 80)}". ` +
    "Text arrives in small pieces to simulate streaming, so you can test the " +
    "interface without calling a real model.";

  const delay = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

  if (CONFIG.MOCK_ERROR) {
    await delay(CONFIG.MOCK_DELAY_MS * 5);
    if (signal?.aborted) return { ...result, aborted: true };
    throw mockError(CONFIG.MOCK_ERROR);
  }

  for (const token of reply.match(/\S+\s*/g)) {
    if (signal?.aborted) return { ...result, aborted: true };
    await delay(CONFIG.MOCK_DELAY_MS);
    if (signal?.aborted) return { ...result, aborted: true };
    result.text += token;
    emit(token, result.text);
  }
  result.finishReason = "stop";
  return result;
}

function mockError(code) {
  const samples = {
    network: new ModelError("network", "Mock network error"),
    timeout: new ModelError("timeout", `Mock timeout after ${CONFIG.TIMEOUT_MS} ms`),
    rate_limit: new ModelError("rate_limit", "Mock rate limit (429)", { status: 429, retryAfter: 10 }),
    http: new ModelError("http", "Mock HTTP 500", { status: 500 }),
    empty_response: new ModelError("empty_response", "Mock empty response"),
    bad_response: new ModelError("bad_response", "Mock unparsable response"),
  };
  return samples[code] || new ModelError(code, `Mock error: ${code}`);
}
