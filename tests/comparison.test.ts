import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReports, isReport } from '../src/shared/comparison';
import { demoReport } from '../src/server/demo';

test('unchanged configuration distinguishes reserve and lifecycle changes', () => {
  const a = demoReport('trading'), b = demoReport('pending');
  const result = compareReports(a, b);
  assert.equal(result.changes.length, 2);
  assert.ok(result.changes.every(change => change.category === 'state'));
});
test('fee recipient and lock changes are configuration changes', () => {
  const a = demoReport('trading'), b = structuredClone(a);
  b.launch.feeClaimer = 'different-recipient';
  b.launch.allocations[1].permanentLockedPercent = 0;
  const result = compareReports(a, b);
  assert.deepEqual(result.changes.map(c => c.field), ['launch.feeClaimer', 'liquidity.Creator.permanentLockedPercent']);
  assert.ok(result.changes.every(c => c.category === 'configuration'));
});
test('network, pool and source mismatches are rejected', () => {
  const a = demoReport('trading');
  for (const alter of [
    (b: typeof a) => { b.cluster = 'mainnet-beta'; },
    (b: typeof a) => { b.pool.address = 'different-pool'; },
    (b: typeof a) => { b.source = 'live'; },
  ]) { const b = structuredClone(a); alter(b); assert.throws(() => compareReports(a, b), /same pool/); }
});
test('malformed reports and non-finite values are rejected', () => {
  const a = demoReport('trading');
  assert.equal(isReport({ schemaVersion: 1 }), false);
  const b = structuredClone(a); b.launch.startingFeeBps = Number.NaN;
  assert.equal(isReport(b), false);
  const c = structuredClone(a); c.launch.allocations[1].owner = 'Partner';
  assert.equal(isReport(c), false);
  assert.throws(() => compareReports(a, {}), /complete LaunchCheck/);
});
test('decimal strings preserve values beyond Number precision', () => {
  const a = demoReport('trading'), b = structuredClone(a);
  a.pool.quoteReserve = '9007199254740993.000000001';
  b.pool.quoteReserve = '9007199254740993.000000002';
  const result = compareReports(a, b);
  assert.equal(result.changes[0].before, '9007199254740993.000000001');
  assert.equal(result.changes[0].after, '9007199254740993.000000002');
});
test('allocation order and observation time do not create spurious changes', () => {
  const a = demoReport('trading'), b = structuredClone(a);
  b.launch.allocations.reverse(); b.fetchedAt = '2026-10-04T00:00:00.000Z';
  assert.equal(compareReports(a, b).changes.length, 0);
});
test('JSON arrays cannot masquerade as report enum strings', () => {
  const report = demoReport('trading');
  const malformed = JSON.parse(JSON.stringify(report));
  malformed.launch.allocations[0].owner = ['Partner'];
  assert.equal(isReport(malformed), false);
  assert.throws(() => compareReports(malformed, report), /complete LaunchCheck/);
  const wrongSource = { ...report, source: ['demo'] };
  assert.equal(isReport(wrongSource), false);
});
