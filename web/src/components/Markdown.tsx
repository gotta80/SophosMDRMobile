import { Fragment, ReactNode } from 'react';

/**
 * Minimal and safe Markdown renderer (no raw HTML, no clickable links:
 * Sophos content contains "defanged" URLs and must not be made navigable).
 * Supports: headings, bold, italic, `code`, lists, tables, separators, code blocks.
 */
function inline(text: string, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={k}>{inline(t.slice(2, -2), k)}</strong>);
    else if (t.startsWith('`'))
      out.push(
        <code key={k} className="break-words rounded bg-black/5 px-1 py-0.5 text-[0.85em] dark:bg-white/10">
          {t.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // code block
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={k++} className="my-2 overflow-x-auto rounded-lg bg-black/5 p-2 text-xs dark:bg-white/10">
          <code>{buf.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl <= 2 ? 'mt-4 text-base font-bold' : 'mt-3 text-sm font-semibold';
      blocks.push(<p key={k++} className={`${cls} first:mt-0`}>{inline(h[2].replace(/:$/, ''))}</p>);
      i++;
      continue;
    }
    // separator
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={k++} className="my-3 border-black/10 dark:border-white/10" />);
      i++;
      continue;
    }
    // table
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="my-2 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="border-b border-black/10 px-2 py-1 font-semibold dark:border-white/10">{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="border-b border-black/5 px-2 py-1 align-top dark:border-white/5">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // lists
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(
        <L key={k++} className={`my-1.5 space-y-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((t, j) => <li key={j}>{inline(t)}</li>)}
        </L>,
      );
      continue;
    }
    // paragraph (consecutive lines)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*([-*+]|\d+[.)])\s+|```|\s*(-{3,}|\*{3,})\s*$)/.test(lines[i]) &&
      !(lines[i].includes('|') && isTableSep(lines[i + 1] ?? ''))
    ) buf.push(lines[i++]);
    blocks.push(
      <p key={k++} className="my-1.5 break-words">
        {buf.map((t, j) => <Fragment key={j}>{j > 0 && ' '}{inline(t)}</Fragment>)}
      </p>,
    );
  }

  return <div className="text-[15px] leading-relaxed">{blocks}</div>;
}
