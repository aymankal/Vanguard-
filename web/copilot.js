/* Vanguard Copilot — chat panel. Relies on globals from app.js (api, el, state, store, navigate, route, refreshCounts, toast, copyText). */
(function () {
  const panel = document.getElementById("copilot");
  const log = document.getElementById("cp-log");
  const form = document.getElementById("cp-form");
  const input = document.getElementById("cp-input");
  const suggestBox = document.getElementById("cp-suggest");
  const contextBox = document.getElementById("cp-context");
  const modeLabel = document.getElementById("cp-mode");
  const sendBtn = form.querySelector(".cp-send");
  const KEY = "copilot-history";
  let history = store.get(KEY, []);
  let busy = false;

  /* ------------------------------------------------------------ render */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function inline(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((#\/[a-z]+(?:\/\d+)?)\)/g, '<a href="$2" data-cp-link>$1</a>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }
  function markdown(text) {
    const out = [];
    const parts = String(text).split(/```(?:\w+)?\n?/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        out.push(`<pre>${esc(part.replace(/\n$/, ""))}<button type="button" class="copy">Copy</button></pre>`);
        return;
      }
      let list = false;
      for (const raw of part.split("\n")) {
        const line = raw.trimEnd();
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/) || line.match(/^\s*\d+[.)]\s+(.*)$/);
        if (bullet) {
          if (!list) { out.push("<ul>"); list = true; }
          out.push(`<li>${inline(bullet[1])}</li>`);
          continue;
        }
        if (list) { out.push("</ul>"); list = false; }
        if (line.trim()) out.push(`<p>${inline(line)}</p>`);
      }
      if (list) out.push("</ul>");
    });
    return out.join("");
  }

  function scroll() {
    log.scrollTop = log.scrollHeight;
  }

  function addMessage(role, text, actions = [], { error = false } = {}) {
    log.querySelector(".cp-welcome")?.remove();
    const node = el("div", { className: `cp-msg ${role === "user" ? "user" : "bot"}${error ? " error" : ""}` });
    if (role === "user") node.textContent = text;
    else node.innerHTML = markdown(text);
    if (actions.length) {
      node.append(el("div", { className: "cp-actions" }, actions.map((a) =>
        el("a", { className: "cp-action", href: a.href || "#/", textContent: a.label, dataset: { cpLink: "" } }))));
    }
    log.append(node);
    scroll();
    return node;
  }

  function welcome() {
    log.innerHTML = "";
    log.append(el("div", { className: "cp-welcome" }, [
      el("div", { className: "cp-mark", innerHTML: '<svg><use href="#i-spark"/></svg>' }),
      el("h3", { textContent: "How can I help?" }),
      el("p", { textContent: "Plan your day, prep for a call, update records or draft a client email. I can see the page you're on." }),
    ]));
  }

  function renderHistory() {
    if (!history.length) return welcome();
    log.innerHTML = "";
    history.forEach((m) => addMessage(m.role, m.text, m.actions || []));
  }

  /* ----------------------------------------------------------- context */
  function currentContext() {
    const r = state.route || {};
    return { view: r.view, id: r.id };
  }

  async function refreshContext() {
    const { view, id } = currentContext();
    const title = document.getElementById("view-title")?.textContent || "";
    const kinds = { contacts: "contact", companies: "company", deals: "deal", notes: "note" };
    contextBox.innerHTML = id && kinds[view] ? `Looking at ${kinds[view]} <strong>${esc(title)}</strong> — say “this” to refer to it.` : "";
    try {
      const list = await api(`/assistant/suggestions?view=${encodeURIComponent(view || "")}&id=${encodeURIComponent(id || "")}`);
      suggestBox.innerHTML = "";
      list.forEach((q) => suggestBox.append(el("button", { type: "button", textContent: q, onclick: () => ask(q) })));
    } catch {}
    const ai = state.meta?.ai_enabled;
    modeLabel.textContent = ai ? "Powered by Claude · can update your CRM" : "Built-in assistant · can update your CRM";
  }

  /* --------------------------------------------------------------- send */
  async function ask(text) {
    if (busy || !text.trim()) return;
    open();
    const message = text.trim();
    addMessage("user", message);
    const priorHistory = history.map(({ role, text }) => ({ role, text }));
    history.push({ role: "user", text: message });
    input.value = "";
    autosize();
    busy = true;
    sendBtn.disabled = true;
    const typing = el("div", { className: "cp-typing", "aria-label": "Copilot is typing" }, [el("i"), el("i"), el("i")]);
    log.append(typing);
    scroll();
    try {
      const res = await api("/assistant", { method: "POST", body: { message, history: priorHistory, context: currentContext() } });
      typing.remove();
      addMessage("assistant", res.reply, res.actions || []);
      history.push({ role: "assistant", text: res.reply, actions: res.actions || [] });
      if (res.actions?.length) {
        // The assistant changed data: redraw the page underneath and the sidebar counts.
        await loadLookups().catch(() => {});
        route();
      }
    } catch (err) {
      typing.remove();
      addMessage("assistant", `Something went wrong: ${err.message}. Try again in a moment.`, [], { error: true });
    } finally {
      busy = false;
      sendBtn.disabled = false;
      history = history.slice(-40);
      store.set(KEY, history);
      input.focus();
    }
  }

  /* --------------------------------------------------------- open/close */
  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    document.body.classList.add("copilot-open");
    renderHistory();
    refreshContext();
    setTimeout(() => input.focus(), 30);
  }
  function close() {
    panel.hidden = true;
    document.body.classList.remove("copilot-open");
  }
  const toggle = () => (panel.hidden ? open() : close());

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      ask(input.value);
    }
  });
  document.getElementById("cp-close").onclick = close;
  document.getElementById("cp-reset").onclick = () => {
    history = [];
    store.set(KEY, history);
    welcome();
    input.focus();
  };
  document.querySelectorAll("[data-copilot-open]").forEach((b) => (b.onclick = open));

  panel.addEventListener("click", async (e) => {
    const copy = e.target.closest(".copy");
    if (copy) {
      const text = copy.parentElement.firstChild.textContent;
      await copyText(text, "Draft copied");
      return;
    }
    const a = e.target.closest("a[data-cp-link]");
    if (a && window.matchMedia("(max-width: 760px)").matches) close();
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      toggle();
    }
  });
  window.addEventListener("crm:route", () => { if (!panel.hidden) refreshContext(); });

  window.Copilot = { open, close, toggle, ask };
  // Home-screen shortcut "Ask Copilot" opens the app with ?copilot in the hash.
  if (/copilot/.test(location.hash)) {
    try { window.history.replaceState(null, "", "#/"); } catch {}
    setTimeout(open, 300);
  }
})();
