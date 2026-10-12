// Build the hosted bundle and write the page (dist/index.html) that loads it.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
execSync('npx vite build --config hosted/vite.config.ts', { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname });
const css = fs.readFileSync(`${here}dist/app.css`, 'utf8');
const page = `<title>Lean CRM</title>
<style>${css}
#boot{display:grid;place-items:center;min-height:60vh;font:14px/1.4 ui-sans-serif,system-ui,sans-serif;color:#71717a}
</style>
<div id="boot">Starting Lean CRM…</div>
<div id="root"></div>
<script type="module" src="app.js"></script>
`;
fs.writeFileSync(`${here}dist/index.html`, page);
console.log(`page ${page.length} bytes, app.js ${fs.statSync(`${here}dist/app.js`).size} bytes`);
