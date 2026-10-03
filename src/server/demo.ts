import type { InspectionReport } from '../shared/report';

export function demoReport(scenario: string): InspectionReport {
  if (!['trading', 'pending', 'migrated'].includes(scenario)) throw new Error('Unknown sample scenario.');
  const migrated = scenario === 'migrated';
  const trading = scenario === 'trading';
  return {
    schemaVersion: 1, source: 'demo', cluster: 'devnet',
    fetchedAt: '2026-10-03T09:00:00.000Z', slot: null,
    pool: {
      address: 'sample-pool-launchcheck', configAddress: 'sample-config-launchcheck',
      baseMint: 'sample-base-token', quoteMint: 'So11111111111111111111111111111111111111112',
      creator: 'sample-creator-wallet', quoteSymbol: 'SOL', quoteDecimals: 9,
      quoteReserve: trading ? '6.42' : '10', migrationThreshold: '10',
      progressPercent: trading ? 64.2 : 100,
    },
    launch: {
      stage: trading ? 'trading' : migrated ? 'migrated' : 'migration-ready',
      migrationTarget: 'DAMM v2', startingFeeBps: 200, endingFeeBps: 25,
      dynamicFees: true, creatorTradingFeePercent: 50, migrationFeePercent: 0,
      feeClaimer: 'sample-partner-wallet', leftoverReceiver: 'sample-creator-wallet',
      allocations: [
        { owner: 'Partner', unlockedPercent: 0, permanentLockedPercent: 20, vestingPercent: 0, vestingDescription: null },
        { owner: 'Creator', unlockedPercent: 10, permanentLockedPercent: 50, vestingPercent: 20, vestingDescription: 'Illustrative 30-day schedule; not an on-chain observation.' },
      ],
    },
    migration: {
      dammPoolAddress: migrated ? 'sample-damm-pool' : null,
      verified: migrated ? true : null,
      nextStep: trading ? 'The curve is still trading. Migration starts after the configured quote threshold is reached.'
        : migrated ? 'The example shows a completed migration. Inspect a real pool to read chain evidence.'
          : 'The curve is complete. The next step is to create the DAMM v2 pool using the official migrator.',
    },
    checks: [
      { id: 'supported', title: 'Supported launch family', status: 'pass', detail: 'Example: standard SPL token, SOL quote and DAMM v2 target.' },
      { id: 'allocation', title: 'Liquidity allocation totals 100%', status: 'pass', detail: 'Example allocation: 10% unlocked, 70% permanently locked and 20% vesting.' },
      { id: 'dynamic-fees', title: 'Trading fee can change', status: 'warning', detail: 'The fee schedule is only the base fee. A volatility-based dynamic fee can also apply.' },
      { id: 'migration', title: 'DAMM v2 handoff', status: migrated ? 'pass' : trading ? 'unknown' : 'warning',
        detail: migrated ? 'Illustrative destination pool exists. This is sample data, not transaction evidence.'
          : trading ? 'The threshold has not been reached; a destination pool is not expected yet.'
            : 'Reaching 100% does not prove migration. A destination pool has not been confirmed in this example.' },
      { id: 'positions', title: 'Actual position locks', status: 'unknown', detail: 'Configured allocations are shown. Individual DAMM position ownership and locks are not independently verified by this MVP.' },
    ],
    limitations: [
      'Illustrative sample data. No RPC request or transaction produced this report.',
      'Checks cover specific configuration facts; they do not establish token safety or future performance.',
    ],
    evidence: [],
  };
}
