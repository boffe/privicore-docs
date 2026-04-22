/**
 * Floating AI assistant launcher for the Privicore docs site.
 *
 * - Renders a purple "AI" button in the bottom-right of every page.
 * - Click opens a chat panel; first send prompts for an Anthropic API
 *   key that's stored in localStorage and sent only to Anthropic.
 * - Queries go directly to the Messages API with prompt caching on
 *   the large (OpenAPI + guides) context block, streaming back via
 *   SSE. Assistant messages are markdown-rendered on completion.
 */

const STORAGE_KEY = "privicore-docs-anthropic-key";
const CONTEXT_URL = "/assets/ai-context.json";

/** Fetched lazily on first panel open. */
let contextPromise = null;
function loadContext() {
  if (!contextPromise) {
    contextPromise = fetch(CONTEXT_URL).then((r) => {
      if (!r.ok) throw new Error(`context fetch failed: ${r.status}`);
      return r.json();
    });
  }
  return contextPromise;
}

/* ---------- DOM scaffold ---------- */

function ensureLauncher() {
  if (document.querySelector(".dpai-launcher")) return;

  const launcher = document.createElement("button");
  launcher.className = "dpai-launcher";
  launcher.setAttribute("aria-label", "Open AI assistant");
  launcher.textContent = "AI";
  document.body.appendChild(launcher);

  const panel = document.createElement("div");
  panel.className = "dpai-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Privicore docs AI assistant");
  panel.innerHTML = `
    <div class="dpai-header">
      <h3>Ask the docs</h3>
      <div class="dpai-header-actions">
        <button class="dpai-clear" title="Clear conversation">Clear</button>
        <button class="dpai-reset-key" title="Re-enter API key">Key</button>
        <button class="dpai-close" title="Close" aria-label="Close">×</button>
      </div>
    </div>
    <div class="dpai-key-modal dpai-hidden">
      <h4>Anthropic API key</h4>
      <p>
        Ask-AI runs against your own Anthropic account.
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Generate a key</a>
        and paste it below. It stays in your browser — we don't send it anywhere except Anthropic's API.
      </p>
      <input class="dpai-key-input" type="password" placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
      <div class="dpai-key-modal-actions">
        <button class="dpai-key-cancel">Cancel</button>
        <button class="dpai-key-save">Save</button>
      </div>
    </div>
    <div class="dpai-messages"></div>
    <div class="dpai-input-row">
      <textarea class="dpai-input" placeholder="Ask about any endpoint or flow…" rows="1"></textarea>
      <button class="dpai-send" disabled>Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  wireEvents(launcher, panel);
}

function wireEvents(launcher, panel) {
  const messages = panel.querySelector(".dpai-messages");
  const input = panel.querySelector(".dpai-input");
  const sendBtn = panel.querySelector(".dpai-send");
  const clearBtn = panel.querySelector(".dpai-clear");
  const resetKeyBtn = panel.querySelector(".dpai-reset-key");
  const closeBtn = panel.querySelector(".dpai-close");
  const keyModal = panel.querySelector(".dpai-key-modal");
  const keyInput = panel.querySelector(".dpai-key-input");
  const keySave = panel.querySelector(".dpai-key-save");
  const keyCancel = panel.querySelector(".dpai-key-cancel");

  const state = { history: [] };

  launcher.addEventListener("click", () => {
    const isOpen = panel.classList.toggle("dpai-open");
    if (isOpen) {
      loadContext().catch((err) => {
        appendMessage(messages, "error", `Failed to load docs context: ${err.message}`);
      });
      if (!messages.children.length) {
        appendMessage(messages, "system", "Ask anything about the Privicore API — endpoints, flows, gotchas.");
      }
      setTimeout(() => input.focus(), 50);
    }
  });
  closeBtn.addEventListener("click", () => panel.classList.remove("dpai-open"));

  input.addEventListener("input", () => {
    sendBtn.disabled = input.value.trim().length === 0;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendBtn.click();
    }
  });

  sendBtn.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;

    if (!getKey()) {
      showKeyModal(keyModal, keyInput);
      return;
    }

    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;
    appendMessage(messages, "user", text);
    state.history.push({ role: "user", content: text });

    try {
      const ctx = await loadContext();
      const assistantEl = appendMessage(messages, "assistant", "");
      const reply = await sendMessage(ctx, state.history, (chunk) => {
        // Stream plain text so the user sees progress immediately.
        assistantEl.textContent += chunk;
        messages.scrollTop = messages.scrollHeight;
      });
      // Render markdown once streaming completes.
      assistantEl.innerHTML = renderMarkdown(reply);
      messages.scrollTop = messages.scrollHeight;
      state.history.push({ role: "assistant", content: reply });
    } catch (err) {
      appendMessage(messages, "error", String(err?.message ?? err));
    } finally {
      input.focus();
    }
  });

  clearBtn.addEventListener("click", () => {
    state.history = [];
    messages.innerHTML = "";
    appendMessage(messages, "system", "Conversation cleared.");
  });

  resetKeyBtn.addEventListener("click", () => {
    keyInput.value = getKey() ?? "";
    showKeyModal(keyModal, keyInput);
  });
  keySave.addEventListener("click", () => {
    const v = keyInput.value.trim();
    if (!v) return;
    localStorage.setItem(STORAGE_KEY, v);
    keyInput.value = "";
    hideKeyModal(keyModal);
  });
  keyCancel.addEventListener("click", () => {
    keyInput.value = "";
    hideKeyModal(keyModal);
  });
}

function appendMessage(container, role, text) {
  const el = document.createElement("div");
  el.className = `dpai-message dpai-${role}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

function showKeyModal(modal, input) {
  modal.classList.remove("dpai-hidden");
  setTimeout(() => input.focus(), 50);
}
function hideKeyModal(modal) {
  modal.classList.add("dpai-hidden");
}

function getKey() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

/* ---------- LLM call ---------- */

// Fast + cheap model, well-suited for docs Q&A. Swap to claude-sonnet-4-6
// for harder questions if the answers feel thin.
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Build the large, static context block Anthropic will cache. Keep
 *  this output stable between calls — any variation busts the cache. */
function buildContextBlock(ctx) {
  const parts = [
    "# Privicore API — reference context",
    "",
    "You are the AI assistant for the Privicore API documentation. Answer the",
    "user's question using ONLY the OpenAPI spec and guide content attached",
    "below. When referencing endpoints, always include the HTTP method and",
    "full path (e.g. `POST /data-token/reserve-token-space`). When a question",
    "spans a multi-step flow, cite the relevant guide (e.g. `/guides/store-and-retrieve.html`)",
    "before drilling into individual endpoints. Use fenced code blocks for",
    "curl / JSON / JS examples. If the spec or guides don't cover the topic,",
    "say so plainly instead of inventing behaviour.",
    "",
    "---",
    "",
    "## OpenAPI spec",
    "",
    "```json",
    JSON.stringify(ctx.openapi),
    "```",
    "",
    "---",
    "",
    "## Guides",
    "",
  ];
  for (const g of ctx.guides) {
    parts.push(`### ${g.title}  (${g.url})`);
    parts.push("");
    parts.push(g.markdown);
    parts.push("");
  }
  return parts.join("\n");
}

async function sendMessage(ctx, history, onChunk) {
  const apiKey = getKey();
  if (!apiKey) throw new Error("No API key configured.");

  const contextBlock = buildContextBlock(ctx);
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      stream: true,
      system: [
        // First block: short, volatile — no caching.
        { type: "text", text: "You answer questions about the Privicore API, grounded in the context below." },
        // Second block: large, static — cached. Same content every call = cache hit.
        { type: "text", text: contextBlock, cache_control: { type: "ephemeral" } },
      ],
      messages: history,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const err = await response.json();
      detail = err?.error?.message || err?.message || "";
    } catch { /* ignore */ }
    if (response.status === 401) {
      throw new Error("Anthropic rejected the API key. Click 'Key' to re-enter it.");
    }
    if (response.status === 429) {
      throw new Error("Rate limited by Anthropic. Wait a moment and try again.");
    }
    throw new Error(`Anthropic API error ${response.status}${detail ? ": " + detail : ""}`);
  }

  // Parse SSE: lines like `event: TYPE` / `data: {...}` separated by `\n\n`.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const chunk = event.delta.text ?? "";
        if (chunk) {
          full += chunk;
          onChunk(chunk);
        }
      }
    }
  }

  return full;
}

/* ---------- Markdown rendering ----------
 *
 * Minimal — enough for docs answers (fenced code, inline code, bold,
 * italic, links, lists, paragraphs). No blockquotes, no tables, no
 * setext headers. Swap in marked.js later if we outgrow this.
 */

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isSafeHref(href) {
  const h = href.trim();
  // Relative or fragment links are safe.
  if (h.startsWith("/") || h.startsWith("#")) return true;
  // Explicit safe schemes.
  return /^(https?:|mailto:)/i.test(h);
}

function renderMarkdown(text) {
  // Pull fenced code blocks out first so inner content isn't touched
  // by inline rules; re-inject after.
  const fences = [];
  let work = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = fences.length;
    fences.push({ lang, code });
    return ` FENCE${i} `;
  });

  work = escapeHtml(work);

  // Inline code.
  work = work.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Bold (before italic, to avoid `**` being eaten as italic).
  work = work.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Italic.
  work = work.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // Links — scheme-validated. Anchor hrefs produced by the LLM can
  // only be http(s), mailto, or relative (/ or #); anything else
  // (javascript:, data:, vbscript:) is dropped and the text stays as
  // plain, non-linked content. Blocks XSS via coerced link payloads.
  work = work.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text, href) => {
      const safe = isSafeHref(href);
      return safe
        ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>`
        : text;
    },
  );

  // Bullet lists.
  work = work.replace(/(?:^|\n)((?:- [^\n]+\n?)+)/g, (_m, block) => {
    const items = block.trim().split(/\n/).map((l) => `<li>${l.replace(/^- /, "")}</li>`).join("");
    return `\n<ul>${items}</ul>`;
  });

  // Paragraphs — only wrap runs of non-block text.
  work = work
    .split(/\n{2,}/)
    .map((p) => {
      const t = p.trim();
      if (!t) return "";
      if (t.startsWith("<") || t.startsWith(" FENCE")) return t;
      return `<p>${t.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  // Re-inject fenced code blocks.
  work = work.replace(/ FENCE(\d+) /g, (_m, idx) => {
    const f = fences[Number(idx)];
    const cls = f.lang ? ` class="language-${escapeHtml(f.lang)}"` : "";
    return `<pre><code${cls}>${escapeHtml(f.code)}</code></pre>`;
  });

  return work;
}


/* ---------- Bootstrap ---------- */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureLauncher);
} else {
  ensureLauncher();
}
