const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { extract, buildContext } = require('../src/documents');
const { markdownToDocx } = require('../src/exporter');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vai-'));

test('Word export round-trips through the Word reader', async () => {
  const buf = await markdownToDocx('# Terms\n\n- **Notice:** 30 days\n- Fee `USD 4,000`\n\n1. Sign\n\nPlain line', 'Contract review');
  const file = path.join(tmp, 'out.docx');
  fs.writeFileSync(file, buf);
  const doc = await extract(file);
  assert.match(doc.text, /Contract review/);
  assert.match(doc.text, /Notice: 30 days/);
  assert.match(doc.text, /USD 4,000/);
});

test('reads spreadsheets sheet by sheet', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Pipeline');
  ws.addRow(['Client', 'MRR']);
  ws.addRow(['Acme', 12000]);
  ws.addRow(['Globex', { formula: 'B2*2', result: 24000 }]);
  const file = path.join(tmp, 'p.xlsx');
  await wb.xlsx.writeFile(file);
  const doc = await extract(file);
  assert.match(doc.text, /\[Sheet: Pipeline\]/);
  assert.match(doc.text, /Acme\t12000/);
  assert.match(doc.text, /Globex\t24000/);
});

test('reads PDFs with page markers', async () => {
  // Smallest valid one-page PDF with text.
  const stream = 'BT /F1 18 Tf 50 700 Td (Termination requires 60 days notice) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const file = path.join(tmp, 'c.pdf');
  fs.writeFileSync(file, pdf);
  const doc = await extract(file);
  assert.equal(doc.pages, 1);
  assert.match(doc.text, /\[Page 1\]/);
  assert.match(doc.text, /60 days notice/);
});

test('rejects unsupported files', async () => {
  const file = path.join(tmp, 'x.exe');
  fs.writeFileSync(file, 'MZ');
  await assert.rejects(extract(file), /Unsupported/);
});

test('long documents are cut down to the passages that match the question', () => {
  const filler = 'General boilerplate about the services and the parties. '.repeat(400);
  const text = `${filler}\nThe termination fee is USD 25,000 payable within 15 days.\n${filler}`;
  const { context, trimmed } = buildContext([{ name: 'msa.pdf', text }], 'What is the termination fee?', 4000);
  assert.ok(trimmed);
  assert.ok(context.length < 6000);
  assert.match(context, /termination fee is USD 25,000/);
});

test('short documents go in whole', () => {
  const { context, trimmed } = buildContext([{ name: 'a.txt', text: 'hello' }], 'q', 1000);
  assert.equal(trimmed, false);
  assert.equal(context, '<document name="a.txt">\nhello\n</document>');
});

test('local model streaming and download progress (mock Ollama)', async () => {
  const seen = {};
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen[req.url] = body && JSON.parse(body);
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 5e9 }] }));
      if (req.url === '/api/pull') {
        res.write('{"status":"pulling","completed":1,"total":2}\n{"status":"pull');
        return setTimeout(() => res.end('ing","completed":2,"total":2}\n{"status":"success"}\n'), 20);
      }
      if (req.url === '/api/chat') {
        res.write('{"message":{"content":"Hel"}}\n');
        return res.end('{"message":{"content":"lo"}}\n{"done":true}');
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise((r) => server.listen(11434, '127.0.0.1', r));
  try {
    const p = require('../src/providers');
    const status = await p.ollamaStatus();
    assert.deepEqual(status, { running: true, models: [{ name: 'qwen3:8b', size: 5e9 }] });
    const progress = [];
    await p.ollamaPull('qwen3:8b', (x) => progress.push(x.status));
    assert.deepEqual(progress, ['pulling', 'pulling', 'success']);
    let out = '';
    await p.streamOllama({ model: 'qwen3:8b', system: 'sys', messages: [{ role: 'user', content: 'hi' }], onText: (t) => (out += t) });
    assert.equal(out, 'Hello');
    assert.equal(seen['/api/chat'].messages[0].role, 'system');
    assert.equal(seen['/api/chat'].options.num_ctx, p.LOCAL_CONTEXT_TOKENS);
  } finally {
    server.close();
  }
});
