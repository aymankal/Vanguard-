import { Fragment, type ReactNode } from 'react';

/** Minimal, safe Markdown: headings, lists, bold, italics, code, http(s) links. */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|(?<![*\w])\*([^*\n]+)\*(?!\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${m.index}`;
    if (m[1]) out.push(<strong key={k}>{inline(m[1], key + 1)}</strong>);
    else if (m[2]) out.push(<a key={k} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>);
    else if (m[4]) out.push(<code key={k} className="rounded bg-zinc-100 px-1 text-[0.9em] dark:bg-zinc-800">{m[4]}</code>);
    else if (m[5]) out.push(<em key={k}>{m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const Tag = list.ordered ? 'ol' : 'ul';
      blocks.push(<Tag key={blocks.length}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
    }
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      blocks.push(h[1].length <= 2 ? <h2 key={blocks.length}>{inline(h[2])}</h2> : <h3 key={blocks.length}>{inline(h[2])}</h3>);
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return <div className={`prose-sm text-sm leading-relaxed ${className}`}>{blocks}</div>;
}
