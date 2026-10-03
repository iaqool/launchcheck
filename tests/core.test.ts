import assert from 'node:assert/strict';
import test from 'node:test';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import { BaseFeeMode, type PoolConfig, type VirtualPool } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { buildReportFromAccounts, deriveStage, formatTokenAmount, progressPercent } from '../src/core/checks.js';
import { inspectPool, InspectionError } from '../src/core/inspect.js';

const key = (byte: number) => new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
const poolAddress = key(8).toBase58();
const configAddress = key(9);
const baseMint = key(10);

function fixture(options: {
  reserve?: string;
  threshold?: string;
  migrationProgress?: number;
  isMigrated?: number;
  dammVerified?: boolean | null;
  feeMode?: number;
  dynamicFee?: number;
  periodFrequency?: number;
} = {}) {
  const config = {
    quoteMint: NATIVE_MINT,
    feeClaimer: key(11),
    leftoverReceiver: key(12),
    migrationQuoteThreshold: new BN(options.threshold ?? '20000000000'),
    creatorTradingFeePercentage: 15,
    migrationFeePercentage: 2,
    partnerLiquidityPercentage: 30,
    partnerPermanentLockedLiquidityPercentage: 20,
    creatorLiquidityPercentage: 20,
    creatorPermanentLockedLiquidityPercentage: 10,
    partnerLiquidityVestingInfo: {
      isInitialized: 1,
      vestingPercentage: 10,
      cliffDurationFromMigrationTime: 86_400,
      numberOfPeriods: 10,
      frequency: 86_400,
      bpsPerPeriod: 1_000,
    },
    creatorLiquidityVestingInfo: {
      isInitialized: 1,
      vestingPercentage: 10,
      cliffDurationFromMigrationTime: 0,
      numberOfPeriods: 5,
      frequency: 86_400,
      bpsPerPeriod: 2_000,
    },
    poolFees: {
      baseFee: {
        cliffFeeNumerator: new BN(100_000_000),
        firstFactor: 10,
        secondFactor: new BN(options.periodFrequency ?? 60),
        thirdFactor: new BN(1_000_000),
        baseFeeMode: options.feeMode ?? BaseFeeMode.FeeSchedulerLinear,
      },
      dynamicFee: { initialized: options.dynamicFee ?? 0 },
    },
  } as unknown as PoolConfig;
  const pool = {
    poolState: {
      config: configAddress,
      baseMint,
      creator: key(13),
      quoteReserve: new BN(options.reserve ?? '10000000000'),
      migrationProgress: options.migrationProgress ?? 0,
      isMigrated: options.isMigrated ?? 0,
    },
  } as VirtualPool;
  return buildReportFromAccounts({
    address: poolAddress,
    cluster: 'devnet',
    fetchedAt: '2026-10-03T00:00:00.000Z',
    slot: 123,
    pool,
    config,
    quoteDecimals: 9,
    dammPoolAddress: options.dammVerified ? key(14).toBase58() : null,
    dammVerified: options.dammVerified ?? null,
  });
}

test('formats u64-sized token quantities without Number precision loss', () => {
  assert.equal(formatTokenAmount(9_007_199_254_740_993n, 9), '9007199.254740993');
  assert.equal(formatTokenAmount(new BN('18446744073709551615'), 9), '18446744073.709551615');
  assert.equal(progressPercent(9_007_199_254_740_993n, 18_014_398_509_481_986n), 50);
  const report = fixture({ reserve: '9007199254740993', threshold: '18014398509481986' });
  assert.equal(report.pool.quoteReserve, '9007199.254740993');
  assert.equal(report.pool.migrationThreshold, '18014398.509481986');
  assert.equal(report.pool.progressPercent, 50);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('fee bounds follow SDK linear scheduler math and dynamic fee is not presented as total fee', () => {
  const report = fixture({ dynamicFee: 1 });
  assert.equal(report.launch.startingFeeBps, 1000);
  assert.equal(report.launch.endingFeeBps, 900);
  assert.equal(report.launch.dynamicFees, true);
  assert.match(report.checks.find(check => check.id === 'fee-schedule')!.detail, /actual trading fee can be higher/);
  assert.equal(fixture({ feeMode: 2 }).launch.startingFeeBps, null);
  assert.equal(fixture({ feeMode: 2 }).checks.find(check => check.id === 'fee-schedule')!.status, 'unknown');
  assert.equal(fixture({ periodFrequency: 0 }).launch.endingFeeBps, 1000);
});

test('DBC state needs DAMM account evidence before reporting migrated', () => {
  assert.equal(fixture().launch.stage, 'trading');
  assert.equal(fixture({ reserve: '20000000000', migrationProgress: 1 }).launch.stage, 'curve-complete');
  assert.equal(fixture({ reserve: '20000000000', migrationProgress: 2 }).launch.stage, 'migration-ready');
  const missing = fixture({ reserve: '20000000000', migrationProgress: 3, dammVerified: false });
  assert.equal(missing.launch.stage, 'unknown');
  assert.equal(missing.migration.verified, false);
  assert.equal(missing.checks.find(check => check.id === 'damm-pool')!.status, 'warning');
  const migrated = fixture({ reserve: '20000000000', migrationProgress: 3, dammVerified: true });
  assert.equal(migrated.launch.stage, 'migrated');
  assert.equal(migrated.checks.find(check => check.id === 'position-locks')!.status, 'unknown');
  assert.equal(fixture({ reserve: '20000000000', migrationProgress: 2, isMigrated: 1, dammVerified: true }).launch.stage, 'migrated');
  assert.equal(deriveStage(0, 0, 20n, 20n, null), 'unknown');
});

test('configured allocation checks do not assert actual LP locks', () => {
  const report = fixture();
  assert.equal(report.launch.allocations.reduce((sum, part) => sum + part.unlockedPercent + part.permanentLockedPercent + part.vestingPercent, 0), 100);
  assert.equal(report.checks.find(check => check.id === 'liquidity-plan')!.status, 'pass');
  assert.equal(report.checks.find(check => check.id === 'position-locks')!.status, 'unknown');
});

test('invalid pool address is classified before any RPC read', async () => {
  await assert.rejects(inspectPool('not-a-solana-address', 'devnet', 'http://127.0.0.1:1'), error => error instanceof InspectionError && error.code === 'INVALID_ADDRESS');
});

