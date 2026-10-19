// Saves an answer as a Word document, turning the Markdown the models write into real
// headings, bullets and bold text.
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

function runs(line) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index > last) out.push(new TextRun(line.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true }));
    else if (t.startsWith('`')) out.push(new TextRun({ text: t.slice(1, -1), font: 'Consolas' }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true }));
    last = m.index + t.length;
  }
  if (last < line.length) out.push(new TextRun(line.slice(last)));
  return out;
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

function markdownToDocx(markdown, title) {
  const children = [];
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));
  let inCode = false;
  for (const raw of markdown.split('\n')) {
    if (raw.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      children.push(new Paragraph({ children: [new TextRun({ text: raw, font: 'Consolas' })] }));
      continue;
    }
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      children.push(new Paragraph({ children: runs(m[2]), heading: HEADINGS[m[1].length - 1] }));
    } else if ((m = line.match(/^(\s*)[-*•]\s+(.*)$/))) {
      children.push(new Paragraph({ children: runs(m[2]), bullet: { level: Math.min(Math.floor(m[1].length / 2), 3) } }));
    } else if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) {
      children.push(new Paragraph({ children: [new TextRun(`${m[2]}. `), ...runs(m[3])], indent: { left: 360 } }));
    } else if (/^\|?\s*:?-{3,}/.test(line)) {
      continue; // table divider row
    } else if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      children.push(new Paragraph({ children: runs(cells.join('   |   ')) }));
    } else {
      children.push(new Paragraph({ children: runs(line.replace(/^>\s?/, '')) }));
    }
  }
  return Packer.toBuffer(new Document({ creator: 'Vanguard AI', title: title || 'Vanguard AI', sections: [{ children }] }));
}

module.exports = { markdownToDocx };
