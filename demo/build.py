"""Bundle the CRM into one self-contained HTML page that runs without the server.

The real frontend is used as-is; demo/mock-api.js answers its /api calls in the browser
from demo/seed.json. Regenerate the seed from a freshly seeded database with --seed.

    python demo/build.py [--seed] [-o demo/dist/vanguard-crm-demo.html]
"""

import argparse
import base64
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FRONTEND = os.path.join(ROOT, "web")
TABLES = ["companies", "contacts", "deals", "notes", "tasks", "activities"]


def regenerate_seed() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "seed.db")
        env = {**os.environ, "CRM_DB_PATH": path, "CRM_AI_DISABLED": "1"}
        subprocess.run([sys.executable, "seed.py"], cwd=ROOT, env=env, check=True)
        sys.path.insert(0, ROOT)
        from crm.notetaker import TEMPLATES

        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        data = {"base_date": date.today().isoformat(), "templates": TEMPLATES}
        for table in TABLES:
            data[table] = [dict(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY id")]
        conn.close()
    with open(os.path.join(HERE, "seed.json"), "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=0)


def read(*parts: str) -> str:
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


DEMO_CSS = """
.demo-bar {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 6px 16px; white-space: nowrap; overflow: hidden; font-size: 12px; background: var(--accent-soft); color: var(--text);
  border-bottom: 1px solid var(--line);
}
.demo-bar strong { color: var(--accent); letter-spacing: .06em; text-transform: uppercase; font-size: 11px; }
.demo-bar button { background: none; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; color: var(--text); cursor: pointer; font: inherit; }
.demo-bar button:hover { border-color: var(--accent); }
body { background: var(--bg); }
"""

DEMO_BAR = """
<div class="demo-bar" role="note">
  <strong>Demo</strong>
  <span>Sample data, saved on this device only.</span>
  <button type="button" id="demo-reset">Reset demo</button>
</div>
"""

DEMO_JS = """
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="/api/"]');
  if (!a) return;
  e.preventDefault();
  toast("Exports download from the hosted CRM. This demo keeps its data in your browser.");
}, true);
document.getElementById("demo-reset").onclick = async () => {
  window.__resetDemo();
  try { localStorage.removeItem("vcrm:recent"); } catch {}
  await loadLookups();
  toast("Demo data reset");
  navigate("#/");
};
"""


def build(out: str) -> None:
    html = read(FRONTEND, "index.html")
    css = read(FRONTEND, "styles.css") + DEMO_CSS
    app = read(FRONTEND, "app.js")
    copilot = read(FRONTEND, "copilot.js")
    mock = read(HERE, "mock-api.js")
    shim = "  /* ------------------------------------------------------- fetch shim */"
    assert shim in mock
    mock = mock.replace(shim, read(HERE, "copilot-offline.js") + shim, 1)
    seed = read(HERE, "seed.json")
    with open(os.path.join(FRONTEND, "logo.png"), "rb") as f:
        logo = "data:image/png;base64," + base64.b64encode(f.read()).decode()

    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = re.sub(r'\s*<script src="/static/[a-z]+\.js"></script>', "", body)
    body = body.replace("/static/logo.png", logo)
    body = body.replace('<div class="app">', DEMO_BAR + '<div class="app">', 1)
    safe_seed = seed.replace("</", "<\\/")

    page = f"""<title>Vanguard CRM</title>
<link rel="icon" href="{logo}" type="image/png" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" />
<style>
{css}
</style>
{body}
<script>window.__SEED__ = {safe_seed};</script>
<script>
{mock}
</script>
<script>
{app}
{DEMO_JS}
</script>
<script>
{copilot}
</script>
"""
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"wrote {out} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", action="store_true", help="regenerate demo/seed.json first")
    parser.add_argument("-o", "--out", default=os.path.join(HERE, "dist", "vanguard-crm-v2-demo.html"))
    args = parser.parse_args()
    if args.seed:
        regenerate_seed()
    build(args.out)
