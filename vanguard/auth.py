"""Sign-in for Vanguard Docs, plus the second lock on the Case File.

- APP_PASSWORD turns on the login page (signed 30-day session cookie). HTTP Basic is still
  accepted for scripts; browsers never get the native Basic pop-up (unusable in installed apps).
- CASE_PASSWORD is a separate passcode for the Case File. Unlocking it sets a second signed
  cookie that lasts CASE_HOURS. Without CASE_PASSWORD the Case File is switched off entirely,
  so restricted records are never readable with the shared login alone.
"""

import base64
import hashlib
import hmac
import html
import os
import secrets
import time
from collections import defaultdict, deque
from typing import Optional
from urllib.parse import parse_qs

COOKIE = "vg_session"
CASE_COOKIE = "vg_case"
SESSION_DAYS = 30
CASE_HOURS = 8
MAX_FAILURES = 8
FAILURE_WINDOW = 15 * 60
PUBLIC_PATHS = {"/healthz", "/manifest.webmanifest", "/sw.js", "/login", "/logout"}
PUBLIC_PREFIXES = ("/static/icon-", "/static/apple-touch-icon", "/static/logo.png")

_failures: dict[str, deque] = defaultdict(deque)


def enabled() -> bool:
    return bool(os.environ.get("APP_PASSWORD", "").strip())


def case_enabled() -> bool:
    return bool(os.environ.get("CASE_PASSWORD", "").strip())


def expected() -> tuple[str, str]:
    username = (os.environ.get("APP_USERNAME") or "vanguard").strip()
    return username, os.environ.get("APP_PASSWORD", "").strip()


def check_credentials(username: str, password: str) -> bool:
    """Username ignores case and surrounding spaces (phone keyboards capitalise it)."""
    want_user, want_pass = expected()
    user_ok = secrets.compare_digest(username.strip().lower().encode(), want_user.lower().encode())
    pass_ok = secrets.compare_digest(password.strip().encode(), want_pass.encode())
    return user_ok and pass_ok


def check_case_password(password: str) -> bool:
    want = os.environ.get("CASE_PASSWORD", "").strip()
    return bool(want) and secrets.compare_digest(password.strip().encode(), want.encode())


# ------------------------------------------------------------- tokens
def _sign(key: bytes, seconds: int) -> str:
    payload = str(int(time.time()) + seconds)
    return f"{payload}.{hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()}"


def _verify(key: bytes, token: Optional[str]) -> bool:
    if not token or "." not in token:
        return False
    payload, sig = token.rsplit(".", 1)
    good = hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()
    return secrets.compare_digest(sig, good) and payload.isdigit() and int(payload) > time.time()


def _key() -> bytes:
    # Derived from the credentials, so changing the password signs everyone out.
    user, password = expected()
    return hashlib.sha256(f"vg-session|{user.lower()}|{password}".encode()).digest()


def _case_key() -> bytes:
    return hashlib.sha256(f"vg-case|{os.environ.get('CASE_PASSWORD', '').strip()}".encode()).digest()


def make_session() -> str:
    return _sign(_key(), SESSION_DAYS * 86400)


def make_case_session() -> str:
    return _sign(_case_key(), CASE_HOURS * 3600)


def valid_session(token: Optional[str]) -> bool:
    return _verify(_key(), token)


def valid_basic(header: str) -> bool:
    if not header.lower().startswith("basic "):
        return False
    try:
        user, _, given = base64.b64decode(header[6:]).decode().partition(":")
    except ValueError:
        return False
    return check_credentials(user, given)


def is_public(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES)


def authorized(request) -> bool:
    return valid_session(request.cookies.get(COOKIE)) or valid_basic(request.headers.get("authorization", ""))


def case_unlocked(request) -> bool:
    return case_enabled() and _verify(_case_key(), request.cookies.get(CASE_COOKIE))


# ------------------------------------------------------------ throttling
def _client(request) -> str:
    return request.client.host if request.client else "unknown"


def locked_for(request) -> int:
    """Seconds until this client may try again (0 when not locked)."""
    q = _failures[_client(request)]
    now = time.time()
    while q and now - q[0] > FAILURE_WINDOW:
        q.popleft()
    return int(FAILURE_WINDOW - (now - q[0])) + 1 if len(q) >= MAX_FAILURES else 0


def record_failure(request) -> None:
    _failures[_client(request)].append(time.time())


def clear_failures(request) -> None:
    _failures.pop(_client(request), None)


def parse_form(body: bytes) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(body.decode("utf-8", "replace")).items()}


def safe_next(target: str) -> str:
    # Only same-app hash routes; never redirect off-site.
    return target if target.startswith("#/") else "#/"


def cookie_header(name: str, value: str, secure: bool, max_age: int) -> str:
    parts = [f"{name}={value}", "Path=/", "HttpOnly", "SameSite=Strict" if name == CASE_COOKIE else "SameSite=Lax",
             f"Max-Age={max_age}"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


FAILED = "Wrong username or password."
ADMIN_HINT = (
    "Admin: the login is APP_USERNAME and APP_PASSWORD under Environment in Render. "
    "No password set? A temporary one is printed in the service logs."
)


def locked_message(seconds: int) -> str:
    minutes = max(1, round(seconds / 60))
    return f"Too many attempts from this device. Try again in {minutes} minute{'s' if minutes > 1 else ''}."


# ------------------------------------------------------------- the page
def login_page(error: str = "", username: str = "", next_hash: str = "#/") -> str:
    err = f'<p class="error" role="alert">{html.escape(error)}</p>' if error else ""
    hint = f'<p class="help">{html.escape(ADMIN_HINT)}</p>' if error == FAILED else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Sign in · Vanguard Docs</title>
<meta name="theme-color" content="#121715" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/static/logo.png" type="image/png" />
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />
<style>
  :root {{
    --bg: #121715; --panel: #1a201d; --sunk: #222a26; --line: #303a35; --text: #e6ebe8;
    --muted: #97a39c; --accent: #6aa8de; --accent-fg: #0b1520; --danger: #ec8576; color-scheme: dark;
  }}
  @media (prefers-color-scheme: light) {{
    :root {{ --bg: #f3f4f2; --panel: #fff; --sunk: #e9ebe7; --line: #d7dbd4; --text: #16201c;
      --muted: #5d6862; --accent: #165d96; --accent-fg: #fff; --danger: #b03a2e; color-scheme: light; }}
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ height: 100%; }}
  body {{
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 "IBM Plex Sans", -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
  }}
  main {{ width: 100%; max-width: 380px; }}
  .brand {{ display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }}
  .brand img {{ width: 44px; height: 44px; }}
  .brand strong {{ display: block; font-size: 18px; letter-spacing: .04em; }}
  .brand span {{ font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 600; }}
  form {{ background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 22px; display: grid; gap: 14px; }}
  h1 {{ font-size: 20px; margin: 0; }}
  label {{ display: grid; gap: 6px; font-size: 13px; color: var(--muted); }}
  input {{
    font: inherit; font-size: 16px; color: var(--text); background: var(--sunk);
    border: 1px solid var(--line); border-radius: 6px; padding: 11px 12px; width: 100%;
  }}
  input:focus {{ outline: none; border-color: var(--accent); }}
  .pw {{ position: relative; }}
  .pw input {{ padding-right: 64px; }}
  .pw button {{
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none;
    color: var(--accent); font: inherit; font-size: 13px; font-weight: 600; padding: 6px 8px; cursor: pointer;
  }}
  .submit {{
    font: inherit; font-weight: 700; color: var(--accent-fg); background: var(--accent); border: none;
    border-radius: 6px; padding: 12px; cursor: pointer;
  }}
  .submit:focus-visible, .pw button:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}
  .error {{ margin: 0; color: var(--danger); font-size: 14px; }}
  .help {{ font-size: 12px; color: var(--muted); margin: 0; }}
  footer {{ margin-top: 20px; font-size: 11px; color: var(--muted); text-align: center; }}
</style>
</head>
<body>
<main>
  <div class="brand">
    <img src="/static/logo.png" alt="" />
    <div><strong>VANGUARD</strong><span>Document control</span></div>
  </div>
  <form method="post" action="/login" novalidate>
    <h1>Sign in</h1>
    {err}
    <input type="hidden" name="next" id="next" value="{html.escape(next_hash)}" />
    <label>Username
      <input name="username" id="username" value="{html.escape(username)}" autocomplete="username"
             autocapitalize="none" autocorrect="off" spellcheck="false" required {"" if username else "autofocus"} />
    </label>
    <label>Password
      <span class="pw">
        <input name="password" id="password" type="password" autocomplete="current-password" required {"autofocus" if username else ""} />
        <button type="button" id="toggle" aria-label="Show password">Show</button>
      </span>
    </label>
    <button class="submit" type="submit">Sign in</button>
    <p class="help">You stay signed in on this device for {SESSION_DAYS} days.</p>
    {hint}
  </form>
  <footer>&copy; Vanguard Services S.A.L 2026</footer>
</main>
<script>
  const pw = document.getElementById("password"), t = document.getElementById("toggle");
  t.onclick = () => {{
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    t.textContent = show ? "Hide" : "Show";
    t.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }};
  const next = document.getElementById("next");
  if (next.value === "#/" && location.hash.startsWith("#/")) next.value = location.hash;
</script>
</body>
</html>"""
