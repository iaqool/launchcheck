import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfigParameters, MigrationOption, TokenType } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { assertInspectionSnapshot, DEVNET_GENESIS, loadDevnetKeypair, requireDevnet, testCurve, waitForFunding } from '../scripts/rehearsal';
import { demoReport } from '../src/server/demo';

test('rehearsal rejects mainnet, unknown chains and unavailable genesis before writes', async () => {
  for (const genesis of ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'unknown', '']) {
    await assert.rejects(requireDevnet({ getGenesisHash: async () => genesis }), /Refusing writes/);
  }
  await assert.rejects(requireDevnet({ getGenesisHash: async () => { throw new Error('RPC offline'); } }), /RPC offline/);
  await requireDevnet({ getGenesisHash: async () => DEVNET_GENESIS });
});

test('malformed secret input never appears in diagnostics', () => {
  const secret = 'private-input-that-must-not-be-logged';
  assert.throws(() => loadDevnetKeypair(secret), (error: unknown) =>
    error instanceof Error && !error.message.includes(secret));
  assert.throws(() => loadDevnetKeypair(JSON.stringify(Array(64).fill(256))));
});

test('small rehearsal config passes installed SDK validation and stays in supported family', () => {
  const config = testCurve();
  validateConfigParameters({ ...config, leftoverReceiver: loadDevnetKeypair(undefined).publicKey });
  assert.equal(config.tokenType, TokenType.SPLToken);
  assert.equal(config.migrationOption, MigrationOption.MET_DAMM_V2);
  assert.equal(config.migrationQuoteThreshold.toString(), '100000000');
  assert.equal(config.partnerPermanentLockedLiquidityPercentage, 100);
});

test('wait-for-funding returns only after the minimum balance is observed and times out safely', async () => {
  let now = 0;
  let reads = 0;
  const balance = await waitForFunding(async () => (++reads < 3 ? 0 : 500_000_000), {
    timeoutMs: 15_000, pollMs: 5_000, now: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(balance, 500_000_000);
  assert.equal(reads, 3);

  now = 0;
  reads = 0;
  await assert.rejects(waitForFunding(async () => { reads++; return 0; }, {
    timeoutMs: 10_000, pollMs: 5_000, now: () => now,
    sleep: async (ms) => { now += ms; },
  }), /Timed out waiting/);
  assert.equal(reads, 2);
});

test('inspection snapshots require the live devnet pool, expected lifecycle stage and verified DAMM target', () => {
  const dbcPool = 'ExpectedDevnetPoolAddress';
  const dammPool = 'ExpectedDammPoolAddress';
  const trading = demoReport('trading');
  trading.source = 'live';
  trading.cluster = 'devnet';
  trading.pool.address = dbcPool;
  assert.doesNotThrow(() => assertInspectionSnapshot(trading, dbcPool, 'trading'));
  assert.throws(() => assertInspectionSnapshot(trading, 'OtherPoolAddress', 'trading'), /does not match/);
  assert.throws(() => assertInspectionSnapshot(trading, dbcPool, 'migration-ready'), /does not match/);
  const sample = demoReport('trading');
  sample.cluster = 'devnet';
  assert.throws(() => assertInspectionSnapshot(sample, dbcPool, 'trading'), /does not match/);
  const mainnet = structuredClone(trading);
  mainnet.cluster = 'mainnet-beta';
  assert.throws(() => assertInspectionSnapshot(mainnet, dbcPool, 'trading'), /does not match/);

  const migrated = demoReport('migrated');
  migrated.source = 'live';
  migrated.cluster = 'devnet';
  migrated.pool.address = dbcPool;
  migrated.launch.stage = 'migrated';
  migrated.migration.verified = true;
  migrated.migration.dammPoolAddress = dammPool;
  assert.doesNotThrow(() => assertInspectionSnapshot(migrated, dbcPool, 'migrated', dammPool));
  migrated.migration.verified = false;
  assert.throws(() => assertInspectionSnapshot(migrated, dbcPool, 'migrated', dammPool), /does not confirm/);
});
