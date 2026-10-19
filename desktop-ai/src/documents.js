// Turns attached files into text, then fits that text into what the chosen model can read.
// Everything here runs on this machine; nothing is uploaded until a cloud model is asked.
const fs = require('fs/promises');
const path = require('path');

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.log', '.yaml', '.yml', '.rtf']);
const SUPPORTED = ['pdf', 'docx', 'xlsx', ...[...TEXT_EXT].map((e) => e.slice(1))];

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.readFile(file));
  const task = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : ' ');
    pages.push(`[Page ${i}]\n${text.trim()}`);
  }
  const count = doc.numPages;
  await task.destroy();
  return { text: pages.join('\n\n'), pages: count };
}

async function docxText(file) {
  const mammoth = require('mammoth');
  const { value } = await mammoth.extractRawText({ path: file });
  return { text: value };
}

async function xlsxText(file) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const parts = [];
  wb.eachSheet((sheet) => {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values.slice(1).map((v) => {
        if (v == null) return '';
        if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join('') : v instanceof Date ? v.toISOString().slice(0, 10) : '');
        return String(v);
      });
      rows.push(cells.join('\t'));
    });
    parts.push(`[Sheet: ${sheet.name}]\n${rows.join('\n')}`);
  });
  return { text: parts.join('\n\n') };
}

async function extract(file) {
  const ext = path.extname(file).toLowerCase();
  const stat = await fs.stat(file);
  if (stat.size > 50 * 1024 * 1024) throw new Error('File is over 50 MB');
  let out;
  if (ext === '.pdf') out = await pdfText(file);
  else if (ext === '.docx') out = await docxText(file);
  else if (ext === '.xlsx') out = await xlsxText(file);
  else if (TEXT_EXT.has(ext)) out = { text: await fs.readFile(file, 'utf8') };
  else throw new Error(`Unsupported file type ${ext || '(none)'}. Use ${SUPPORTED.join(', ')}.`);
  const text = out.text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error('No readable text found (a scanned PDF needs OCR first).');
  return { name: path.basename(file), chars: text.length, pages: out.pages, text };
}

// ---- Fitting documents into the model's context ----

function chunk(text, size = 1500, overlap = 200) {
  const chunks = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    chunks.push({ start, text: text.slice(start, start + size) });
    if (start + size >= text.length) break;
  }
  return chunks;
}

const STOP = new Set('the a an and or of to in on for with is are was were be by at as it this that from what which who how when where why does do can could should would will i you we they me my our your please about tell give show find list summarize summary document file'.split(' '));

function terms(s) {
  return s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.filter((w) => !STOP.has(w)) || [];
}

// Picks the passages that share the most words with the question, kept in document order.
function relevantPassages(text, question, budget) {
  const q = new Set(terms(question));
  const chunks = chunk(text);
  const scored = chunks.map((c, i) => {
    let score = 0;
    for (const w of terms(c.text)) if (q.has(w)) score++;
    // A small pull toward the opening, which usually says what the document is.
    return { ...c, i, score: score + (i === 0 ? 2 : 0) };
  });
  const picked = [];
  let used = 0;
  for (const c of [...scored].sort((a, b) => b.score - a.score)) {
    if (used + c.text.length > budget) continue;
    picked.push(c);
    used += c.text.length;
  }
  return picked.sort((a, b) => a.i - b.i).map((c) => c.text).join('\n[…]\n');
}

// Builds the document block for the prompt. budgetChars is what the model can take for documents.
function buildContext(docs, question, budgetChars) {
  if (!docs.length) return { context: '', trimmed: false };
  const total = docs.reduce((n, d) => n + d.text.length, 0);
  const trimmed = total > budgetChars;
  const parts = docs.map((d) => {
    const share = Math.floor(budgetChars * (d.text.length / total));
    const body = trimmed ? relevantPassages(d.text, question, share) : d.text;
    return `<document name="${d.name}">\n${body}\n</document>`;
  });
  return { context: parts.join('\n\n'), trimmed };
}

module.exports = { extract, buildContext, relevantPassages, SUPPORTED };
