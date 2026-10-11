const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.OLLAMA_BASE_URL || process.env.LLAMA_BASE_URL || "https://ollama.com/v1").replace(/\/+$/, "");
const API_KEY = process.env.OLLAMA_API_KEY || process.env.LLAMA_API_KEY || "";
const MODEL_FROM_ENV = process.env.OLLAMA_MODEL || process.env.LLAMA_MODEL;
const FALLBACK_MODEL = "gpt-oss:20b";
let model = MODEL_FROM_ENV || FALLBACK_MODEL;

const indexHtml = fs.readFileSync(path.join(__dirname, "index.html"));

// Local Ollama needs no key, so the header is only sent when one is configured.
function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  return headers;
}

function errorMessage(bodyText) {
  try {
    const body = JSON.parse(bodyText);
    const err = body.error || body;
    if (typeof err === "string") return err;
    const parts = [err.code || err.title, err.message || err.detail].filter(Boolean);
    const unique = [...new Set(parts)];
    if (unique.length) return unique.join(": ");
  } catch {}
  return bodyText.trim() || "(empty response body)";
}

async function pickModel() {
  if (MODEL_FROM_ENV) return;
  try {
    const res = await fetch(`${BASE_URL}/models`, { headers: authHeaders() });
    if (!res.ok) {
      console.log(`Model list failed (${res.status}); using ${model}`);
      return;
    }
    const ids = ((await res.json()).data || []).map((m) => m.id);
    if (ids.length && !ids.includes(model)) model = ids[0];
    console.log(`Models available: ${ids.join(", ")}`);
  } catch (e) {
    console.log(`Model list failed (${e.message}); using ${model}`);
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function handleChat(req, res) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let messages;
  try {
    messages = JSON.parse(raw).messages;
  } catch {
    return sendJson(res, 400, { error: { status: 400, message: "Invalid JSON request body" } });
  }

  let upstream;
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ model, messages, stream: true }),
    });
  } catch (e) {
    return sendJson(res, 502, { error: { status: 502, message: `Could not reach ${BASE_URL}: ${e.message}` } });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return sendJson(res, upstream.status, { error: { status: upstream.status, message: errorMessage(text) } });
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for await (const chunk of upstream.body) res.write(chunk);
  res.end();
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(indexHtml);
  }
  if (req.method === "GET" && req.url === "/api/config") {
    return sendJson(res, 200, { baseUrl: BASE_URL, model });
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    return handleChat(req, res).catch((e) => {
      if (!res.headersSent) sendJson(res, 500, { error: { status: 500, message: e.message } });
      else res.end();
    });
  }
  res.writeHead(404).end("Not found");
});

pickModel().then(() => {
  server.listen(PORT, () => {
    console.log(`Chat on http://localhost:${PORT} (base ${BASE_URL}, model ${model}, key ${API_KEY ? "set" : "not set"})`);
  });
});
