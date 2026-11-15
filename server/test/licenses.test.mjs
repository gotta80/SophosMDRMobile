// Run after the build: `npm --prefix server run build && node --test server/test`
import test from 'node:test';
import assert from 'node:assert/strict';
import { mdrLevel, parseRestLicenses } from '../dist/services/licenses.js';

const L = (code, extra = {}) => ({ code, name: code, ...extra });
const NOW = Date.parse('2026-11-15T10:00:00Z');

test('MTR-ADV products are MDR Plus', () => {
  for (const c of ['CIXAMTR-ADV', 'SVRMTR-ADV-ADDON', 'CIXAMTR-ADV-MSP', 'SVRCIXAMTR-ADV-MSP']) {
    assert.equal(mdrLevel([L(c)], NOW), 'mdr_plus', c);
  }
});

test('MTR-STD products are MDR; MTR-ADV wins over MTR-STD', () => {
  assert.equal(mdrLevel([L('CIXAMTR-STD-MSP')], NOW), 'mdr');
  assert.equal(mdrLevel([L('CIXAMTR-STD-MSP'), L('CIXAMTR-ADV')], NOW), 'mdr_plus');
});

test('non-MDR products give no level', () => {
  assert.equal(mdrLevel([L('CIXA'), L('EDR-MSP'), L('XDR-MSP'), L('CZTNA')], NOW), 'none');
  assert.equal(mdrLevel([], NOW), 'none');
});

test('unknown MDR/MTR product falls back to MDR', () => {
  assert.equal(mdrLevel([{ code: 'FOO-1', name: 'Sophos MDR Something' }], NOW), 'mdr');
});

test('expired term licenses do not count; perpetual ones do', () => {
  assert.equal(mdrLevel([L('CIXAMTR-ADV', { endDate: '2026-11-14' })], NOW), 'none');
  assert.equal(mdrLevel([L('CIXAMTR-ADV', { endDate: '2026-11-15' })], NOW), 'mdr_plus'); // end date is inclusive
  assert.equal(mdrLevel([L('CIXAMTR-ADV', { endDate: '2020-01-01', perpetual: true })], NOW), 'mdr_plus');
  assert.equal(mdrLevel([L('CIXAMTR-ADV', { endDate: '2020-01-01' }), L('CIXAMTR-STD-MSP')], NOW), 'mdr');
});

test('REST response is normalized', () => {
  const out = parseRestLicenses({
    licenses: [
      { id: 'a', type: 'term', endDate: '2027-02-25', startDate: '2026-02-26', quantity: 48, product: { code: 'CIXAMTR-ADV', name: 'X MTR Advanced' }, usage: { current: { count: 7 } } },
      { id: 'b', type: 'usage', perpetual: true, unlimited: true, product: { code: 'XDR-MSP', name: 'Sophos XDR' } },
    ],
  });
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].mdr, out[0].quantity, out[0].usage, out[0].type], [true, 48, 7, 'term']);
  assert.deepEqual([out[1].mdr, out[1].unlimited, out[1].type], [false, true, 'usage']);
});

test('pay-as-you-go licenses with no seat in use do not count for the level', () => {
  assert.equal(mdrLevel([L('CIXAMTR-ADV-MSP', { type: 'usage', usage: 0 })], NOW), 'none');
  assert.equal(mdrLevel([L('CIXAMTR-ADV-MSP', { type: 'usage', usage: 6 })], NOW), 'mdr_plus');
  assert.equal(mdrLevel([L('CIXAMTR-ADV-MSP', { type: 'usage', usage: 0 }), L('CIXAMTR-STD-MSP', { type: 'usage', usage: 3 })], NOW), 'mdr');
  // unknown usage (GraphQL fallback) is counted as active
  assert.equal(mdrLevel([L('CIXAMTR-ADV-MSP', { type: 'usage' })], NOW), 'mdr_plus');
});

test('REST usage licenses without usage data are unused (usage 0)', () => {
  const [a] = parseRestLicenses({ licenses: [{ id: 'x', type: 'usage', product: { code: 'CFR-MSP', name: 'CFR' } }] });
  assert.equal(a.usage, 0);
});
