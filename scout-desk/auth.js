/* Scout Desk sign-in: email and password, new members wait for a partner's approval. */
(function () {
  "use strict";
  const D = window.ScoutData, sb = D.sb;
  const $ = (id) => document.getElementById(id);
  let mode = "signin", started = false, busy = false;

  function show(which) {
    $("gate").hidden = which === "app";
    $("desk").hidden = which !== "app";
    $("auth-form").hidden = which !== "auth";
    $("reset-form").hidden = which !== "reset";
    $("pending").hidden = which !== "pending";
    $("gate-loading").hidden = which !== "loading";
  }
  function msg(id, text, bad) { const el = $(id); el.textContent = text || ""; el.classList.toggle("bad", !!bad); }
  function setMode(m) {
    mode = m;
    document.querySelectorAll("#auth-seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.m === m)));
    $("f-name").hidden = m !== "signup";
    $("auth-pass").autocomplete = m === "signup" ? "new-password" : "current-password";
    $("auth-submit").textContent = m === "signup" ? "Create account" : "Sign in";
    msg("auth-msg", "");
  }

  async function enter(session) {
    if (!session) { show("auth"); return; }
    show("loading");
    try {
      const me = await D.join(session.user.user_metadata && session.user.user_metadata.name);
      if (me.role === "pending") {
        $("pending-who").textContent = me.email;
        show("pending");
        return;
      }
      show("app");
      if (!started) { started = true; await window.DeskConnect(); }
    } catch (e) {
      show("auth");
      msg("auth-msg", "Couldn't reach the desk. Check your connection and try again.", true);
    }
  }

  document.querySelectorAll("#auth-seg button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.m)));

  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const email = $("auth-email").value.trim(), password = $("auth-pass").value, name = $("auth-name").value.trim();
    if (!email || !password) return msg("auth-msg", "Enter your email and password.", true);
    if (mode === "signup" && !name) return msg("auth-msg", "Add your name so partners know who you are.", true);
    if (mode === "signup" && password.length < 10) return msg("auth-msg", "Use at least 10 characters for your password.", true);
    busy = true; $("auth-submit").disabled = true; msg("auth-msg", mode === "signup" ? "Creating your account…" : "Signing in…");
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) msg("auth-msg", /confirm/i.test(error.message) ? "Confirm your email first, using the link we sent you." : "Wrong email or password.", true);
      } else {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin + location.pathname } });
        if (error) msg("auth-msg", error.message, true);
        else if (!data.session) { setMode("signin"); msg("auth-msg", "Check your email and tap the confirmation link, then sign in here."); }
      }
    } finally { busy = false; $("auth-submit").disabled = false; }
  });

  $("forgot").addEventListener("click", async () => {
    const email = $("auth-email").value.trim();
    if (!email) return msg("auth-msg", "Enter your email first, then tap Forgot password.", true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    msg("auth-msg", error ? error.message : "Check your email for a link to set a new password.", !!error);
  });

  $("reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = $("reset-pass").value;
    if (password.length < 10) return msg("reset-msg", "Use at least 10 characters.", true);
    const { data, error } = await sb.auth.updateUser({ password });
    if (error) return msg("reset-msg", error.message, true);
    enter(data && (await sb.auth.getSession()).data.session);
  });

  $("pending-check").addEventListener("click", async () => {
    const { data } = await sb.auth.getSession();
    enter(data.session);
  });
  document.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", () => sb.auth.signOut()));

  show("loading");
  sb.auth.onAuthStateChange((event, session) => {
    // Supabase advises against awaiting its own calls inside this callback, so defer the work.
    setTimeout(() => {
      if (event === "PASSWORD_RECOVERY") { show("reset"); return; }
      if (event === "SIGNED_OUT") { location.reload(); return; }
      if (event === "INITIAL_SESSION" || (event === "SIGNED_IN" && !started)) enter(session);
    }, 0);
  });
})();
