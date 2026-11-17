// Run after the build: `npm --prefix server run build && node --test server/test`
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHealth } from '../dist/services/accountHealth.js';

const ok = (extra = {}) => ({ score: 100, snoozed: false, ...extra });

// shape of a real answer (customer with MDR, one server policy below the recommended settings)
const RAW = {
  endpoint: {
    protection: { computer: ok({ total: 8, notFullyProtected: 0 }), server: ok({ total: 0 }) },
    policy: {
      computer: { 'threat-protection': ok({ total: 1, policies: [] }) },
      server: { 'server-threat-protection': { score: 90, total: 1, snoozed: false, policies: [{ id: 'x', name: 'Base Policy' }] } },
    },
    exclusions: { policy: { computer: ok({ total: 1 }), server: ok({ total: 1 }) }, global: ok() },
    tamperProtection: { computer: ok({ total: 8 }), server: ok({ total: 0 }), globalDetail: ok(), global: true },
  },
  mdrDataTelemetry: { protectionImprovement: ok({ total: 3, missingSettings: [] }) },
  mdrAuthorizedContact: { contact: ok({ configured: true }) },
};

test('overall score is the lowest check; empty device checks are not counted', () => {
  const h = parseHealth(RAW);
  assert.equal(h.score, 90);
  const ids = h.items.map((i) => i.id);
  assert.ok(!ids.includes('protection.server') && !ids.includes('tamper.server'), ids.join());
  assert.ok(ids.includes('mdr.telemetry') && ids.includes('mdr.contact'));
  assert.deepEqual(h.items.find((i) => i.id === 'policy.server').detail, ['Base Policy']);
});

test('snoozed checks do not lower the overall score; no checks gives null', () => {
  const raw = structuredClone(RAW);
  raw.endpoint.policy.server['server-threat-protection'].snoozed = true;
  assert.equal(parseHealth(raw).score, 100);
  assert.equal(parseHealth({}).score, null);
});

test('customer without MDR has no MDR checks', () => {
  const { mdrDataTelemetry, mdrAuthorizedContact, ...noMdr } = RAW;
  assert.ok(parseHealth(noMdr).items.every((i) => i.group === 'endpoint'));
});
