/**
 * Sophos key findings are Markdown, but some sections (e.g. "Technical Details") embed raw HTML: <br>, <div>,
 * <style scoped>, pandas-style <table class="dataframe">, <small>... The app renders only Markdown (never raw HTML),
 * so the HTML is converted to plain Markdown here: tables become Markdown tables, line breaks and blocks become
 * newlines, <style>/<script> are dropped and every other known tag is stripped. Text without HTML is returned as is.
 */

// Only well-known HTML tags are touched: things like "<ip-address>" in normal text are left alone.
const TAGS = 'br|hr|div|span|p|table|thead|tbody|tfoot|tr|td|th|style|script|small|b|i|u|strong|em|ul|ol|li|h[1-6]|a|code|pre|font|section|center|sup|sub|img';
const HAS_HTML = new RegExp(`<\\/?(?:${TAGS})\\b[^>]*>`, 'i');
const ANY_TAG = new RegExp(`<\\/?(?:${TAGS})\\b[^>]*>`, 'gi');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', check: '✓' };
export const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Text of a table cell: tags removed, whitespace collapsed, "|" replaced (it is the Markdown column separator). */
const cellText = (html: string) =>
  decode(html.replace(/<br\s*\/?>/gi, ' ').replace(ANY_TAG, ''))
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '/')
    .trim();

function tableToMarkdown(html: string): string {
  const rows: { head: boolean; cells: string[] }[] = [];
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi)];
    if (!cells.length) continue;
    rows.push({ head: cells.every((c) => c[1].toLowerCase() === 'th'), cells: cells.map((c) => cellText(c[2])) });
  }
  if (!rows.length || !rows.some((r) => r.cells.some(Boolean))) return ''; // no rows, or only empty cells
  const header = rows[0].head ? rows.shift()!.cells : rows[0].cells.map(() => ' ');
  const width = Math.max(header.length, ...rows.map((r) => r.cells.length));
  // pandas puts the row index in a first column with an empty header: drop it
  const dropIndex = header[0] === '' && width > 1;
  const fit = (cells: string[]) => {
    const out = Array.from({ length: width }, (_, i) => cells[i] ?? '');
    return dropIndex ? out.slice(1) : out;
  };
  const line = (cells: string[]) => `| ${cells.map((c) => c || ' ').join(' | ')} |`;
  const h = fit(header);
  return ['', line(h), line(h.map(() => '---')), ...rows.map((r) => line(fit(r.cells))), ''].join('\n');
}

export function htmlToMarkdown(src: string): string {
  if (!HAS_HTML.test(src)) return src;
  let s = src.replace(/\r/g, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => tableToMarkdown(t));
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c: string) => `\n\n\`\`\`\n${decode(c.replace(ANY_TAG, ''))}\n\`\`\`\n\n`);
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<hr\s*\/?>/gi, '\n\n---\n\n');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${'#'.repeat(Number(n))} ${t.replace(ANY_TAG, '').trim()}\n\n`);
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  s = s.replace(/<\/?(?:p|div|ul|ol|section|center|thead|tbody|tfoot|tr)\b[^>]*>/gi, '\n\n');
  s = s.replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, (_m, t: string) => (t.trim() ? `**${t.trim()}**` : ''));
  s = s.replace(/<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, (_m, t: string) => (t.trim() ? `*${t.trim()}*` : ''));
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, t: string) => (t.trim() ? `\`${t.trim()}\`` : ''));
  s = s.replace(ANY_TAG, ''); // <a>, <span>, <small>, <font>... : keep the text only (links are never made clickable)
  s = decode(s);
  // trim line ends, and line starts too (except inside code fences)
  let fenced = false;
  s = s
    .split('\n')
    .map((l) => {
      const fence = l.trimStart().startsWith('```');
      if (fence) fenced = !fenced;
      return fenced || fence ? l.replace(/[ \t]+$/g, '') : l.trim();
    })
    .join('\n');
  // a "---" right after a heading is only decoration
  s = s.replace(/^(#{1,6} .*)\n+---[ \t]*(?=\n)/gm, '$1');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
