/**
 * app.js: layout and conversation flow for the chat app.
 *
 * Layout: sidebar open/collapse (drawer on narrow screens), the auto-growing
 * composer (Enter sends, Shift+Enter inserts a newline), pinned to the bottom.
 *
 * Conversation flow: chats persist in localStorage as message trees. Editing
 * a user message or regenerating a reply adds a sibling branch, and a ‹ 1/2 ›
 * switcher moves between siblings. The active branch is what gets sent to
 * the model and shown. Also: Stop (keeps partial text), copy buttons,
 * scroll-follow with "jump to latest", and pass-through suggestion chips.
 *
 * Markdown, settings, theming and error UI belong to later sections.
 */
import { sendToModel } from "./api.js";

// Must match the max-width in the @media rule in styles.css.
const NARROW_QUERY = window.matchMedia("(max-width: 768px)");
const NEW_CHAT_TITLE = "New chat";
const STORAGE_KEY = "chat-app:v1";

const $ = (id) => document.getElementById(id);
const els = {
  app: $("app"),
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  main: document.querySelector(".main"),
  toggle: $("sidebar-toggle"),
  close: $("sidebar-close"),
  newChat: $("new-chat"),
  search: $("chat-search"),
  list: $("chat-list"),
  listEmpty: $("chat-list-empty"),
  title: $("chat-title"),
  messages: $("messages"),
  messagesInner: $("messages-inner"),
  messagesEmpty: $("messages-empty"),
  composer: $("composer"),
  prompt: $("prompt"),
  send: $("send"),
  stop: $("stop"),
  jump: $("jump-latest"),
};

/* --------------------------------------------------------------------------
 * State
 *
 * chat = { id, title, renamed, createdAt, updatedAt, nodes }
 * nodes is a map of id -> node, always containing a "root" node:
 * node = { id, parentId, role, content, children: [ids], active: index,
 *          pending?, stopped?, error?, sources?, suggestions? }
 * ------------------------------------------------------------------------ */
const state = {
  chats: [],
  currentId: null,        // null = an unsaved new chat (created on first send)
  stream: null,           // { chatId, nodeId, controller } while generating
  editingId: null,        // user message being edited inline
  renamingId: null,       // chat being renamed in the sidebar
  renameDraft: null,      // its unsaved name
  sidebarOpenDesktop: true,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const currentChat = () => state.chats.find((c) => c.id === state.currentId);

/* --------------------------------------------------------------------------
 * Persistence (localStorage)
 * ------------------------------------------------------------------------ */
function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!data || !Array.isArray(data.chats)) return;
    state.chats = data.chats;
    state.currentId = state.chats.some((c) => c.id === data.currentId) ? data.currentId : null;
    // A reply that was still streaming when the page closed keeps its partial text.
    for (const chat of state.chats) {
      for (const node of Object.values(chat.nodes)) {
        if (node.pending) { delete node.pending; node.stopped = true; }
      }
    }
  } catch (err) {
    console.warn("Could not read saved chats; starting fresh.", err);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, chats: state.chats, currentId: state.currentId }));
  } catch (err) {
    console.warn("Could not save chats (storage full or unavailable).", err);
  }
}

// Throttled save for streaming, so a reload mid-reply keeps most of it.
function saveSoon() {
  if (!saveTimer) saveTimer = setTimeout(save, 500);
}

/* --------------------------------------------------------------------------
 * Message tree
 * ------------------------------------------------------------------------ */
function createChat() {
  const now = Date.now();
  const chat = {
    id: uid(), title: NEW_CHAT_TITLE, renamed: false, createdAt: now, updatedAt: now,
    nodes: { root: { id: "root", parentId: null, role: "root", content: "", children: [], active: 0 } },
  };
  state.chats.push(chat);
  return chat;
}

/** Add a node under parentId and make it that parent's active child. */
function addNode(chat, parentId, role, content) {
  const node = { id: uid(), parentId, role, content, children: [], active: 0 };
  const parent = chat.nodes[parentId];
  chat.nodes[node.id] = node;
  parent.children.push(node.id);
  parent.active = parent.children.length - 1;
  chat.updatedAt = Date.now();
  return node;
}

/** Nodes on the active branch, from the first message to the last. */
function activePath(chat) {
  const path = [];
  let node = chat.nodes.root;
  while (node.children.length) {
    node = chat.nodes[node.children[Math.min(node.active, node.children.length - 1)]];
    path.push(node);
  }
  return path;
}

/** Nodes from the first message down to `node`, inclusive. */
function pathTo(chat, node) {
  const path = [];
  for (let n = node; n && n.id !== "root"; n = chat.nodes[n.parentId]) path.unshift(n);
  return path;
}

// Empty turns (a reply stopped before any text, or a failed one) are left
// out, since many APIs reject empty messages. Everything else goes as-is.
const toMessages = (nodes) =>
  nodes.filter((n) => n.content).map(({ role, content }) => ({ role, content }));

/* --------------------------------------------------------------------------
 * Conversation actions
 * ------------------------------------------------------------------------ */
function send(text) {
  if (state.stream) return;
  let chat = currentChat();
  if (!chat) {
    chat = createChat();
    state.currentId = chat.id;
  }
  const path = activePath(chat);
  const user = addNode(chat, path.at(-1)?.id ?? "root", "user", text);
  if (!chat.renamed && chat.title === NEW_CHAT_TITLE) chat.title = text.replace(/\s+/g, " ").slice(0, 60);
  generate(chat, user);
}

/** Stream a new assistant reply under userNode (a new sibling if one exists). */
async function generate(chat, userNode) {
  const history = toMessages(pathTo(chat, userNode));
  const reply = addNode(chat, userNode.id, "assistant", "");
  reply.pending = true;
  const controller = new AbortController();
  state.stream = { chatId: chat.id, nodeId: reply.id, controller };
  state.editingId = null;

  save();
  renderChatList();
  if (chat.id === state.currentId) renderMessages({ scroll: "bottom" });
  updateComposer();

  try {
    const result = await sendToModel(history, {
      signal: controller.signal,
      onToken: (_token, full) => {
        reply.content = full;
        paintStreaming(reply);
        saveSoon();
      },
    });
    reply.content = result.text;
    if (result.aborted) reply.stopped = true;
    if (result.sources) reply.sources = result.sources;
    if (result.suggestions) reply.suggestions = result.suggestions;
  } catch (err) {
    // Placeholder until the error-handling section adds real error UI.
    console.error(err);
    reply.content = err.partialText || "";
    reply.error = `[${err.code || "error"}] ${err.message}`;
  } finally {
    delete reply.pending;
    state.stream = null;
    chat.updatedAt = Date.now();
    save();
    renderChatList();
    if (chat.id === state.currentId) renderMessages({ scroll: follow ? "bottom" : "keep" });
    updateComposer();
  }
}

function stop() {
  state.stream?.controller.abort();
}

function regenerate(chat, assistantNode) {
  if (state.stream) return;
  generate(chat, chat.nodes[assistantNode.parentId]);
}

function startEdit(nodeId) {
  if (state.stream) return;
  state.editingId = nodeId;
  renderMessages({ scroll: "keep" });
  const ta = els.messagesInner.querySelector(".message-edit textarea");
  if (ta) {
    autoGrow(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

function cancelEdit() {
  state.editingId = null;
  renderMessages({ scroll: "keep" });
}

/** Editing never overwrites: it adds a sibling user message and a new reply. */
function submitEdit(chat, node, text) {
  state.editingId = null;
  if (text === node.content) return renderMessages({ scroll: "keep" });
  const edited = addNode(chat, node.parentId, "user", text);
  generate(chat, edited);
}

/** Move to the previous (-1) or next (+1) sibling version of a node. */
function switchVersion(chat, node, delta) {
  if (state.stream) return;
  const parent = chat.nodes[node.parentId];
  const index = parent.children.indexOf(node.id) + delta;
  if (index < 0 || index >= parent.children.length) return;
  parent.active = index;
  save();
  renderMessages({ scroll: "keep" });
}

function renameChat(chat, title) {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean && clean !== chat.title) {
    chat.title = clean;
    chat.renamed = true;
    save();
  }
}

function deleteChat(chat) {
  if (!window.confirm(`Delete "${chat.title}"? This can't be undone.`)) return;
  if (state.stream?.chatId === chat.id) stop();
  state.chats = state.chats.filter((c) => c.id !== chat.id);
  if (state.currentId === chat.id) {
    state.currentId = null;
    state.editingId = null;
    renderMessages({ scroll: "bottom" });
  }
  save();
  renderChatList();
}

function selectChat(id) {
  state.currentId = id;
  state.editingId = null;
  save();
  renderChatList();
  renderMessages({ scroll: "bottom" });
  if (NARROW_QUERY.matches) setSidebar(false);
  els.prompt.focus();
}

/* --------------------------------------------------------------------------
 * Shared controls. Edit, regenerate, copy and the version switcher are built
 * only here, so they look and behave the same wherever they appear.
 * ------------------------------------------------------------------------ */
const ICONS = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  regenerate: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  delete: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};

const svg = (name) => `<svg aria-hidden="true" viewBox="0 0 24 24">${ICONS[name]}</svg>`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function actionButton(iconName, label, onClick, { disabled = false, danger = false } = {}) {
  const button = el("button", `action-button${danger ? " action-button--danger" : ""}`);
  button.type = "button";
  button.innerHTML = svg(iconName);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function copyButton(getText, label) {
  let resetTimer;
  const button = actionButton("copy", label, async () => {
    const ok = await copyText(getText());
    clearTimeout(resetTimer);
    button.innerHTML = svg(ok ? "check" : "copy");
    button.toggleAttribute("data-done", ok);
    button.title = ok ? "Copied" : "Copy failed";
    button.setAttribute("aria-label", button.title);
    resetTimer = setTimeout(() => {
      button.innerHTML = svg("copy");
      button.removeAttribute("data-done");
      button.title = label;
      button.setAttribute("aria-label", label);
    }, 1500);
  });
  return button;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (e.g. plain http on a LAN address).
    const ta = el("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function switcher(chat, node, disabled) {
  const siblings = chat.nodes[node.parentId].children;
  const index = siblings.indexOf(node.id);
  const wrap = el("div", "switcher");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Versions");
  wrap.append(
    actionButton("prev", "Previous version", () => switchVersion(chat, node, -1), { disabled: disabled || index === 0 }),
    el("span", "switcher__label", `${index + 1}/${siblings.length}`),
    actionButton("next", "Next version", () => switchVersion(chat, node, +1), { disabled: disabled || index === siblings.length - 1 }),
  );
  return wrap;
}

/* --------------------------------------------------------------------------
 * Message rendering
 * ------------------------------------------------------------------------ */

// Minimal fenced-code detection (```lang ... ```), only so code blocks get a
// copy button. An unclosed fence (mid-stream) runs to the end of the text.
const FENCE = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;

function renderBody(container, text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    const before = text.slice(last, match.index).replace(/\n+$/, "");
    if (before) parts.push(document.createTextNode(before));
    parts.push(codeBlock(match[1].trim(), match[2].replace(/\n$/, "")));
    last = match.index + match[0].length;
  }
  const rest = (last ? text.slice(last).replace(/^\n+/, "") : text).replace(/\n+$/, "");
  if (rest) parts.push(document.createTextNode(rest));
  container.replaceChildren(...parts);
}

function codeBlock(lang, code) {
  const block = el("div", "code-block");
  const header = el("div", "code-block__header");
  header.append(el("span", "", lang || "code"), copyButton(() => code, "Copy code"));
  const pre = el("pre");
  pre.append(el("code", "", code));
  block.append(header, pre);
  return block;
}

function messageView(chat, node, isLast) {
  const article = el("article", `message message--${node.role}`);
  article.dataset.nodeId = node.id;
  article.setAttribute("aria-label", node.role === "user" ? "You" : "Assistant");

  if (node.role === "user" && state.editingId === node.id) {
    article.append(editForm(chat, node));
    return article;
  }

  const body = el("div", "message__body");
  renderBody(body, node.content);
  article.append(body);

  if (node.pending) {
    article.dataset.streaming = "";
    return article;
  }

  if (node.stopped) article.append(el("p", "message__note", "Stopped"));
  if (node.error) article.append(el("p", "message__note", node.error));

  const busy = Boolean(state.stream);
  const actions = el("div", "message-actions");
  if (chat.nodes[node.parentId].children.length > 1) actions.append(switcher(chat, node, busy));
  if (node.role === "user") {
    actions.append(actionButton("edit", "Edit message", () => startEdit(node.id), { disabled: busy }));
  } else {
    if (node.content) actions.append(copyButton(() => node.content, "Copy response"));
    if (isLast) actions.append(actionButton("regenerate", "Regenerate response", () => regenerate(chat, node), { disabled: busy }));
  }
  article.append(actions);

  // Chips appear only when the API returned suggestions (never generated here).
  const chips = isLast && node.role === "assistant" && Array.isArray(node.suggestions)
    ? node.suggestions.filter((s) => typeof s === "string" && s.trim())
    : [];
  if (chips.length && !busy) {
    const list = el("div", "chips");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "Suggested follow-ups");
    for (const text of chips) {
      const chip = el("button", "chip", text);
      chip.type = "button";
      chip.addEventListener("click", () => send(text));
      list.append(chip);
    }
    article.append(list);
  }
  return article;
}

function editForm(chat, node) {
  const form = el("form", "message-edit");
  const ta = el("textarea");
  ta.value = node.content;
  ta.rows = 1;
  ta.setAttribute("aria-label", "Edit message");
  const buttons = el("div", "message-edit__buttons");
  const cancel = el("button", "button button--ghost button--small", "Cancel");
  cancel.type = "button";
  const submit = el("button", "button button--accent button--small", "Send");
  submit.type = "submit";
  buttons.append(cancel, submit);
  form.append(ta, buttons);

  ta.addEventListener("input", () => autoGrow(ta));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  });
  cancel.addEventListener("click", cancelEdit);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (text) submitEdit(chat, node, text);
  });
  return form;
}

/** scroll: "bottom" jumps to the end; "keep" preserves the reading position. */
function renderMessages({ scroll = "bottom" } = {}) {
  const chat = currentChat();
  els.title.textContent = chat?.title ?? NEW_CHAT_TITLE;
  const path = chat ? activePath(chat) : [];
  const top = els.messages.scrollTop;
  const items = path.map((node, i) => messageView(chat, node, i === path.length - 1));
  els.messagesEmpty.hidden = items.length > 0;
  els.messagesInner.replaceChildren(els.messagesEmpty, ...items);
  if (scroll === "bottom") scrollToBottom(true);
  else els.messages.scrollTop = top;
  lastScrollTop = els.messages.scrollTop;
  updateJump();
}

/** Update only the streaming message's text, not the whole list. */
function paintStreaming(node) {
  const body = els.messagesInner.querySelector(`[data-node-id="${node.id}"] .message__body`);
  if (!body) return; // that chat isn't on screen
  renderBody(body, node.content);
  if (follow) scrollToBottom(true);
  else updateJump();
}

/* --------------------------------------------------------------------------
 * Scroll: follow new text unless the user scrolls up; "Jump to latest"
 * ------------------------------------------------------------------------ */
let follow = true;
let lastScrollTop = 0;

const isNearBottom = () =>
  els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 16;

function scrollToBottom(force = false) {
  if (!force && !follow) return;
  els.messages.scrollTop = els.messages.scrollHeight;
  lastScrollTop = els.messages.scrollTop;
  follow = true;
  updateJump();
}

function updateJump() {
  els.jump.hidden = isNearBottom();
}

// Growing content never lowers scrollTop, so a decrease means the user
// scrolled up. Reaching the bottom again resumes following.
els.messages.addEventListener("scroll", () => {
  const top = els.messages.scrollTop;
  if (top < lastScrollTop - 2) follow = false;
  if (isNearBottom()) follow = true;
  lastScrollTop = top;
  updateJump();
}, { passive: true });

els.jump.addEventListener("click", () => {
  scrollToBottom(true);
  els.prompt.focus();
});

/* --------------------------------------------------------------------------
 * Chat list: search, select, rename, delete
 * ------------------------------------------------------------------------ */
function chatMatches(chat, query) {
  if (chat.title.toLowerCase().includes(query)) return true;
  return Object.values(chat.nodes).some((n) => n.content.toLowerCase().includes(query));
}

function renderChatList() {
  const query = els.search.value.trim().toLowerCase();
  const visible = [...state.chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((c) => !query || chatMatches(c, query));

  els.list.replaceChildren(...visible.map(chatListItem));
  els.listEmpty.hidden = visible.length > 0 || state.chats.length === 0;
  els.title.textContent = currentChat()?.title ?? NEW_CHAT_TITLE;

  const input = els.list.querySelector(".chat-item__rename");
  if (input) {
    input.focus();
    if (state.renameDraft == null) input.select();
  }
}

function chatListItem(chat) {
  const li = el("li");
  const row = el("div", "chat-item");
  li.append(row);

  if (state.renamingId === chat.id) {
    const input = el("input", "chat-item__rename");
    // The draft survives re-renders (e.g. a reply finishing mid-rename).
    input.value = state.renameDraft ?? chat.title;
    input.setAttribute("aria-label", "Chat name");
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (commit) renameChat(chat, input.value);
      state.renamingId = null;
      state.renameDraft = null;
      renderChatList();
    };
    input.addEventListener("input", () => { state.renameDraft = input.value; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    // Removing the input during a re-render can fire blur; only a real blur commits.
    input.addEventListener("blur", () => { if (input.isConnected) finish(true); });
    row.append(input);
    return li;
  }

  const select = el("button", "chat-list__item", chat.title);
  select.type = "button";
  select.title = chat.title;
  if (chat.id === state.currentId) select.setAttribute("aria-current", "page");
  select.addEventListener("click", () => selectChat(chat.id));

  const actions = el("div", "chat-item__actions");
  actions.append(
    actionButton("edit", `Rename chat: ${chat.title}`, () => { state.renamingId = chat.id; renderChatList(); }),
    actionButton("delete", `Delete chat: ${chat.title}`, () => deleteChat(chat), { danger: true }),
  );
  row.append(select, actions);
  return li;
}

els.search.addEventListener("input", renderChatList);

els.newChat.addEventListener("click", () => {
  state.currentId = null;
  state.editingId = null;
  save();
  renderChatList();
  renderMessages({ scroll: "bottom" });
  if (NARROW_QUERY.matches) setSidebar(false);
  els.prompt.focus();
});

/* --------------------------------------------------------------------------
 * Sidebar: collapsible column on wide screens, modal drawer on narrow ones
 * ------------------------------------------------------------------------ */
function setSidebar(open, { focus = false } = {}) {
  const narrow = NARROW_QUERY.matches;
  if (!narrow) state.sidebarOpenDesktop = open;

  els.app.dataset.sidebar = open ? "open" : "closed";
  els.toggle.setAttribute("aria-expanded", String(open));
  els.toggle.setAttribute("aria-label", open ? "Close sidebar" : "Open sidebar");
  // A hidden sidebar must not be reachable by Tab. An open drawer covers
  // the main content, so the main content becomes unreachable instead.
  els.sidebar.inert = !open;
  els.main.inert = narrow && open;
  els.scrim.hidden = !(narrow && open);

  if (focus) (open ? els.newChat : els.toggle).focus();
}

els.toggle.addEventListener("click", () =>
  setSidebar(els.app.dataset.sidebar !== "open", { focus: true }));
els.close.addEventListener("click", () => setSidebar(false, { focus: true }));
els.scrim.addEventListener("click", () => setSidebar(false, { focus: true }));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && NARROW_QUERY.matches && els.app.dataset.sidebar === "open") {
    setSidebar(false, { focus: true });
  }
});

// Crossing the breakpoint: narrow starts with the drawer closed, wide
// restores whatever the user last chose on wide.
NARROW_QUERY.addEventListener("change", () =>
  setSidebar(NARROW_QUERY.matches ? false : state.sidebarOpenDesktop));

/* --------------------------------------------------------------------------
 * Composer: auto-grow, Enter to send, Shift+Enter for newline, Stop
 * ------------------------------------------------------------------------ */
function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`; // CSS max-height caps this
  const max = parseFloat(getComputedStyle(ta).maxHeight);
  ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
}

function updateComposer() {
  const streaming = Boolean(state.stream);
  els.send.hidden = streaming;
  els.stop.hidden = !streaming;
  els.send.disabled = els.prompt.value.trim() === "";
}

els.prompt.addEventListener("input", () => { autoGrow(els.prompt); updateComposer(); });

els.prompt.addEventListener("keydown", (e) => {
  // isComposing: don't send while an IME is composing (e.g. Japanese input).
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.composer.requestSubmit();
  }
});

els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.prompt.value.trim();
  if (!text || state.stream) return; // the draft is kept while a reply streams
  els.prompt.value = "";
  autoGrow(els.prompt);
  send(text);
});

els.stop.addEventListener("click", () => {
  stop();
  els.prompt.focus();
});

/* --------------------------------------------------------------------------
 * Startup
 * ------------------------------------------------------------------------ */
load();
setSidebar(!NARROW_QUERY.matches);
renderChatList();
renderMessages({ scroll: "bottom" });
updateComposer();
