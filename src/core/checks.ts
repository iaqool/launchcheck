import {
  BaseFeeMode,
  feeNumeratorToBps,
  getFeeSchedulerMinBaseFeeNumerator,
  isDynamicFeeEnabled,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Allocation, Check, Cluster, InspectionReport, Stage } from '../shared/report.js';

type Input = {
  address: string;
  cluster: Cluster;
  fetchedAt: string;
  slot: number | null;
  pool: VirtualPool;
  config: PoolConfig;
  quoteDecimals: number;
  dammPoolAddress: string | null;
  dammVerified: boolean | null;
};

export function formatTokenAmount(raw: bigint | { toString(radix?: number): string }, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new Error('Invalid mint decimals');
  const amount = BigInt(raw.toString());
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function progressPercent(reserve: bigint, threshold: bigint): number | null {
  if (threshold <= 0n || reserve < 0n) return null;
  const hundredths = (reserve * 10_000n) / threshold;
  return Number(hundredths > 10_000n ? 10_000n : hundredths) / 100;
}

export function deriveStage(progress: number, isMigrated: number, reserve: bigint, threshold: bigint, dammVerified: boolean | null): Stage {
  if (![0, 1, 2, 3].includes(progress) || ![0, 1].includes(isMigrated) || threshold <= 0n) return 'unknown';
  if (progress === 3 || isMigrated === 1) return dammVerified === true ? 'migrated' : 'unknown';
  if (progress === 0) return reserve < threshold ? 'trading' : 'unknown';
  if (reserve < threshold) return 'unknown';
  return progress === 1 ? 'curve-complete' : 'migration-ready';
}

function allocation(config: PoolConfig, owner: Allocation['owner']): Allocation {
  const partner = owner === 'Partner';
  const vesting = partner ? config.partnerLiquidityVestingInfo : config.creatorLiquidityVestingInfo;
  const enabled = vesting.isInitialized === 1;
  return {
    owner,
    unlockedPercent: partner ? config.partnerLiquidityPercentage : config.creatorLiquidityPercentage,
    permanentLockedPercent: partner ? config.partnerPermanentLockedLiquidityPercentage : config.creatorPermanentLockedLiquidityPercentage,
    vestingPercent: enabled ? vesting.vestingPercentage : 0,
    vestingDescription: enabled
      ? `Cliff ${vesting.cliffDurationFromMigrationTime}s; ${vesting.numberOfPeriods} periods every ${vesting.frequency}s; ${vesting.bpsPerPeriod} bps per period`
      : null,
  };
}

function feeBounds(config: PoolConfig): { start: number | null; end: number | null; dynamic: boolean; reason: string | null } {
  const base = config.poolFees.baseFee;
  const dynamic = isDynamicFeeEnabled(config.poolFees.dynamicFee);
  if (base.baseFeeMode !== BaseFeeMode.FeeSchedulerLinear && base.baseFeeMode !== BaseFeeMode.FeeSchedulerExponential) {
    return { start: null, end: null, dynamic, reason: `Base fee mode ${base.baseFeeMode} is not a supported scheduler.` };
  }
  try {
    const end = base.secondFactor.isZero()
      ? base.cliffFeeNumerator
      : getFeeSchedulerMinBaseFeeNumerator(
        base.cliffFeeNumerator,
        base.firstFactor,
        base.thirdFactor,
        base.baseFeeMode,
      );
    return {
      start: feeNumeratorToBps(base.cliffFeeNumerator),
      end: feeNumeratorToBps(end),
      dynamic,
      reason: null,
    };
  } catch {
    return { start: null, end: null, dynamic, reason: 'Stored scheduler parameters could not be evaluated by the SDK.' };
  }
}

export function buildReportFromAccounts(input: Input): InspectionReport {
  const { pool, config } = input;
  const state = pool.poolState;
  const reserve = BigInt(state.quoteReserve.toString());
  const threshold = BigInt(config.migrationQuoteThreshold.toString());
  const stage = deriveStage(state.migrationProgress, state.isMigrated, reserve, threshold, input.dammVerified);
  const allocations = [allocation(config, 'Partner'), allocation(config, 'Creator')];
  const allocationTotal = allocations.reduce((sum, part) => sum + part.unlockedPercent + part.permanentLockedPercent + part.vestingPercent, 0);
  const fees = feeBounds(config);
  const claimedCreated = state.migrationProgress === 3 || state.isMigrated === 1;
  const migrationFlagsDisagree = (state.migrationProgress === 3) !== (state.isMigrated === 1);
  const checks: Check[] = [
    { id: 'dbc-accounts', title: 'DBC accounts', status: 'pass', detail: 'Pool and config were decoded from DBC-owned accounts; pool PDA and mints match.' },
    { id: 'supported-pair', title: 'Supported token pair', status: 'pass', detail: 'SPL Token base mint and wrapped SOL quote mint were read and matched to the config.' },
    { id: 'liquidity-plan', title: 'Configured liquidity allocation', status: allocationTotal === 100 ? 'pass' : 'fail', detail: `Configured partner and creator shares total ${allocationTotal}%. This checks the config, not migrated position ownership or locks.` },
    { id: 'fee-schedule', title: 'DBC base fee schedule', status: fees.reason ? 'unknown' : 'pass', detail: fees.reason ?? `Configured base fee starts at ${fees.start} bps and ends at ${fees.end} bps. ${fees.dynamic ? 'Dynamic fees are enabled; actual trading fee can be higher.' : 'Dynamic fees are disabled.'}` },
    { id: 'migration-state', title: 'Migration state', status: stage === 'unknown' || migrationFlagsDisagree ? 'warning' : 'pass', detail: `DBC progress=${state.migrationProgress}, isMigrated=${state.isMigrated}, quote reserve ${reserve.toString()} raw units versus threshold ${threshold.toString()} raw units.${migrationFlagsDisagree ? ' The two migration flags disagree.' : ''}` },
    { id: 'damm-pool', title: 'DAMM v2 pool', status: input.dammVerified === true ? 'pass' : claimedCreated ? 'warning' : 'unknown', detail: input.dammVerified === true ? 'The DAMM v2 pool PDA derived from the expected fee config exists, is program-owned, and contains the expected mints.' : claimedCreated ? 'DBC reports pool creation, but the DAMM v2 account was missing or did not match.' : 'DAMM v2 pool creation has not been confirmed by DBC state.' },
    { id: 'position-locks', title: 'Migrated position locks', status: 'unknown', detail: 'Position NFTs, ownership, and lock or vesting accounts were not read.' },
  ];
  const limitations = [
    'Accounts were read in separate RPC calls. The displayed slot is the DBC pool read context, not an atomic multi-account snapshot.',
    'Configured liquidity allocation does not prove migrated position ownership, permanent locks, or vesting.',
    'This report is an account inspection, not a security audit or a price forecast.',
  ];
  if (fees.dynamic) limitations.push('Dynamic trading fees depend on volatility state and trade context; the fee bounds shown are base-fee schedule values.');
  if (fees.reason) limitations.push(fees.reason);
  if (claimedCreated && input.dammVerified !== true) limitations.push('DAMM lookup uses the SDK fee-tier config PDA. A pool created with another DAMM config cannot be linked to this DBC pool from these accounts alone.');
  if (stage === 'unknown') limitations.push('Migration flags, threshold, or DAMM account evidence are inconsistent or incomplete.');
  const nextStep = stage === 'trading'
    ? 'Continue DBC curve trading until the configured quote threshold is reached.'
    : stage === 'curve-complete'
      ? 'Create the required locked-vesting locker, then migrate to DAMM v2 using the official manual migrator.'
      : stage === 'migration-ready'
        ? 'Create the DAMM v2 pool using the official manual migrator and verify the resulting pool and positions.'
        : stage === 'migrated'
          ? 'Verify migrated position NFT ownership and lock or vesting accounts before relying on liquidity claims.'
          : 'Re-read the DBC and DAMM accounts and investigate the migration-state mismatch.';
  return {
    schemaVersion: 1,
    source: 'live',
    cluster: input.cluster,
    fetchedAt: input.fetchedAt,
    slot: input.slot,
    pool: {
      address: input.address,
      configAddress: state.config.toBase58(),
      baseMint: state.baseMint.toBase58(),
      quoteMint: config.quoteMint.toBase58(),
      creator: state.creator.toBase58(),
      quoteSymbol: 'SOL',
      quoteDecimals: input.quoteDecimals,
      quoteReserve: formatTokenAmount(reserve, input.quoteDecimals),
      migrationThreshold: formatTokenAmount(threshold, input.quoteDecimals),
      progressPercent: progressPercent(reserve, threshold),
    },
    launch: {
      stage,
      migrationTarget: 'DAMM v2',
      startingFeeBps: fees.start,
      endingFeeBps: fees.end,
      dynamicFees: fees.dynamic,
      creatorTradingFeePercent: config.creatorTradingFeePercentage,
      migrationFeePercent: config.migrationFeePercentage,
      feeClaimer: config.feeClaimer.toBase58(),
      leftoverReceiver: config.leftoverReceiver.toBase58(),
      allocations,
    },
    migration: { dammPoolAddress: input.dammPoolAddress, verified: input.dammVerified, nextStep },
    checks,
    limitations,
    evidence: [
      { label: 'DBC pool', address: input.address, kind: 'account' },
      { label: 'DBC config', address: state.config.toBase58(), kind: 'account' },
      { label: 'Base mint', address: state.baseMint.toBase58(), kind: 'token' },
      { label: 'Quote mint', address: config.quoteMint.toBase58(), kind: 'token' },
      ...(input.dammVerified === true && input.dammPoolAddress ? [{ label: 'DAMM v2 pool', address: input.dammPoolAddress, kind: 'account' as const }] : []),
    ],
  };
}
