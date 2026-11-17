// Run after the build: `npm --prefix server run build && node --test server/test`
import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown } from '../dist/services/htmlText.js';
import { learnAuthors, normalizeComment } from '../dist/services/sophosQueries.js';

const SAMPLE = `## Technical Details


---

<br>

The detections pertain to user \`a.b\` that involved the following IP addresses: <br><br>

<div>
<style scoped>
    .dataframe tbody tr th { vertical-align: top; }
</style>
<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;"><th></th><th>EventTime</th><th>SourceAddress</th><th>Was MFA Used</th></tr>
  </thead>
  <tbody>
    <tr><th>0</th><td>2026-11-16 10:32:52</td><td>212.107.69.136</td><td>✔</td></tr>
    <tr><th>1</th><td>2026-11-16 10:29:03</td><td>165.225.203.59</td><td>✔</td></tr>
  </tbody>
</table>
</div>

<br>

<small>The table displays logins &amp; MFA.</small>`;

test('plain Markdown is returned unchanged', () => {
  const md = '## Title\n\nSome **bold** text with <ip-address> and a | pipe.';
  assert.equal(htmlToMarkdown(md), md);
});

test('HTML sections become readable Markdown', () => {
  const out = htmlToMarkdown(SAMPLE);
  assert.ok(!/<[a-z\/]/i.test(out.replace('<ip', '')), out);
  assert.ok(!out.includes('dataframe') && !out.includes('vertical-align'), 'style removed');
  assert.match(out, /^## Technical Details\n\nThe detections pertain/);
  assert.match(out, /\| EventTime \| SourceAddress \| Was MFA Used \|\n\| --- \| --- \| --- \|\n\| 2026-11-16 10:32:52 \| 212\.107\.69\.136 \| ✔ \|/);
  assert.match(out, /The table displays logins & MFA\./);
  assert.ok(!/\n{3,}/.test(out));
});

test('lists, bold and entities', () => {
  const out = htmlToMarkdown('<p>Hello <b>world</b> &lt;ok&gt;</p><ul><li>one</li><li>two</li></ul>');
  assert.equal(out, 'Hello **world** <ok>\n\n- one\n- two');
});

const raw = (authorId, comment) => ({ id: authorId + comment.length, authorId, comment, createdAt: '2026-11-16T10:00:00Z', isInternal: false });

test('colleagues are learned from @sophos, the SOC from @authorized_contacts', () => {
  const colleagues = new Set();
  const soc = new Set();
  const list = [
    raw('soc-1', '@authorized_contacts Hi Team, please review'),
    raw('mtr-to-central', 'Customer Action Required email sent'),
    raw('user-9', 'Hi @sophos, I confirm the user is on VPN. Gabriele'),
    raw('soc-2', 'Thanks for the update'),
  ];
  learnAuthors(list, new Set(['me']), colleagues, soc);
  const roles = list.map((c) => normalizeComment(c, new Set(['me']), colleagues).author.role);
  assert.deepEqual(roles, ['analyst', 'system', 'colleague', 'analyst']);
  assert.ok(colleagues.has('user-9') && !colleagues.has('soc-1'));
});

test('empty tables are dropped and paragraph indentation is trimmed', () => {
  const out = htmlToMarkdown('<div>  Hello <br>   world</div><table><tr><th></th></tr></table>');
  assert.equal(out, 'Hello\nworld');
});
