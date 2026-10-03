import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { relative, resolve } from 'node:path';
import BN from 'bn.js';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint, NATIVE_MINT, TOKEN_PROGRAM_ID, type Mint } from '@solana/spl-token';
import {
  ActivationType, BaseFeeMode, buildCurve, CollectFeeMode,
  DAMM_V2_MIGRATION_FEE_ADDRESS, DAMM_V2_PROGRAM_ID, deriveDammV2PoolAddress,
  deriveDbcPoolAddress, DynamicBondingCurveClient, DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  getCurrentPoint, MigrationFeeOption, MigrationOption, TokenAuthorityOption, TokenDecimal,
  TokenType, validateConfigParameters, type PoolConfig, type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm } from '@meteora-ag/cp-amm-sdk';
import { inspectPool } from '../src/core/inspect';
import { createRpcFetch } from '../src/core/rpc';
import { isReport } from '../src/shared/comparison';
import type { InspectionReport } from '../src/shared/report';
import { loadPersistentDevnetKeypair } from './devnet-wallet';
import { prepareGraduationSwap } from './graduate';

export { loadDevnetKeypair } from './devnet-wallet';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

export async function requireDevnet(connection: Pick<Connection, 'getGenesisHash'>): Promise<void> {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS) {
    throw new Error('Refusing writes: RPC genesis hash is not Solana devnet.');
  }
}

export async function waitForFunding(
  readBalance: () => Promise<number>,
  options: { minimumLamports?: number; timeoutMs?: number; pollMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
  const minimumLamports = options.minimumLamports ?? 500_000_000;
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const pollMs = options.pollMs ?? 5_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  while (true) {
    if (now() >= deadline) throw new Error('Timed out waiting for at least 0.5 devnet SOL.');
    const balance = await readBalance();
    if (balance >= minimumLamports) return balance;
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Timed out waiting for at least 0.5 devnet SOL.');
    await sleep(Math.min(pollMs, remaining));
  }
}

export function testCurve() {
  return buildCurve({
    token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000, leftover: 0 },
    fee: { baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
      feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0, poolCreationFee: 0, enableFirstSwapWithMinFee: false },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 0, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Slot,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: 0.1,
  });
}

type Evidence = {
  schemaVersion: 1; kind: 'devnet-test-rehearsal'; startedAt: string;
  completedAt?: string; status: 'running' | 'passed' | 'failed';
  stage: string; genesisHash?: string; payer?: string;
  addresses: Record<string, string>;
  inspectionReports: { step: InspectionStep; path: string }[];
  transactions: { step: string; signature: string; confirmed: boolean; slot?: number; blockhash?: string; lastValidBlockHeight?: number }[];
  checks: Record<string, string | boolean>; error?: string;
  limitations: string[];
};

export type RehearsalOptions = {
  payer?: Keypair;
  waitForFunding?: boolean;
  /** Continue a created devnet test pool; traded pools additionally require verified evidence. */
  resumePool?: string;
  /** Evidence for the completed buy/sell steps, verified on-chain before skipping them. */
  resumeEvidence?: string;
  /** Retained across attempts by the interactive session. */
  budget?: RehearsalBudget;
};

/** Validate the test pool and its expected stage before the resumed payer spends anything. */
export function assertResumeState(pool: PublicKey, state: VirtualPool, config: PoolConfig, mint: Mint, afterTrades = false): void {
  const expected = testCurve();
  const supply = expected.tokenSupply;
  assert(supply, 'Devnet test curve must have a fixed token supply.');
  const actual = state.poolState;
  assert(deriveDbcPoolAddress(NATIVE_MINT, actual.baseMint, actual.config).equals(pool), 'Resume pool PDA does not match its config and mint.');
  assert(config.quoteMint.equals(NATIVE_MINT) && config.quoteTokenFlag === TokenType.SPLToken &&
    config.tokenType === TokenType.SPLToken && actual.poolType === TokenType.SPLToken,
  'Resume pool must be a standard SPL / SOL pool.');
  assert(actual.migrationProgress === 0 && actual.isMigrated === 0 && (afterTrades
    ? actual.hasSwap === 1 && actual.quoteReserve.gt(new BN(0)) && actual.quoteReserve.lt(config.migrationQuoteThreshold)
    : actual.quoteReserve.isZero() && actual.hasSwap === 0),
  'Resume pool does not match the expected trading or migration state.');
  assert(config.migrationOption === expected.migrationOption && config.migrationFeeOption === expected.migrationFeeOption &&
    config.migrationQuoteThreshold.eq(expected.migrationQuoteThreshold) &&
    config.sqrtStartPrice.eq(expected.sqrtStartPrice) &&
    config.preMigrationTokenSupply.eq(supply.preMigrationTokenSupply) &&
    config.postMigrationTokenSupply.eq(supply.postMigrationTokenSupply) &&
    config.tokenDecimal === expected.tokenDecimal && config.collectFeeMode === expected.collectFeeMode &&
    config.partnerPermanentLockedLiquidityPercentage === expected.partnerPermanentLockedLiquidityPercentage &&
    config.partnerLiquidityPercentage === expected.partnerLiquidityPercentage &&
    config.creatorPermanentLockedLiquidityPercentage === expected.creatorPermanentLockedLiquidityPercentage &&
    config.creatorLiquidityPercentage === expected.creatorLiquidityPercentage &&
    config.poolFees.baseFee.cliffFeeNumerator.eq(expected.poolFees.baseFee.cliffFeeNumerator) &&
    config.poolFees.baseFee.baseFeeMode === expected.poolFees.baseFee.baseFeeMode,
  'Resume pool config does not match the devnet test curve.');
  assert(mint.decimals === expected.tokenDecimal && mint.supply === BigInt(supply.preMigrationTokenSupply.toString()),
    'Resume base mint does not match the devnet test supply.');
}

export function assertTradeResumeEvidence(value: unknown, pool: string, payer: string): asserts value is Evidence {
  assert(value && typeof value === 'object', 'Resume evidence is missing.');
  const previous = value as Evidence;
  assert(previous.schemaVersion === 1 && previous.kind === 'devnet-test-rehearsal' &&
    previous.genesisHash === DEVNET_GENESIS && previous.addresses?.dbcPool === pool && previous.payer === payer,
  'Resume evidence must match this devnet pool and payer.');
  assert(Array.isArray(previous.transactions) && previous.transactions.length === 2 &&
    previous.transactions[0]?.step === 'dbc-buy' && previous.transactions[1]?.step === 'dbc-sell' &&
    previous.transactions.every(tx => tx.confirmed === true && typeof tx.signature === 'string') &&
    previous.transactions[0].signature !== previous.transactions[1].signature,
  'Resume requires exactly two confirmed DBC trade steps and no later submissions.');
}

export type RehearsalBudget = {
  spentLamports?: bigint;
  pending?: { signature: string; lastValidBlockHeight: number; step: string };
};

/** Resolve the previous signed write before any new write can use this payer. */
export async function reconcileBudget(
  connection: Pick<Connection, 'getSignatureStatuses' | 'getTransaction' | 'getBlockHeight'>,
  payer: Keypair['publicKey'], budget: RehearsalBudget,
): Promise<void> {
  const pending = budget.pending;
  if (!pending) return;
  const status = (await connection.getSignatureStatuses([pending.signature], { searchTransactionHistory: true })).value[0];
  const transaction = await connection.getTransaction(pending.signature, {
    commitment: 'confirmed', maxSupportedTransactionVersion: 0,
  });
  if (transaction?.meta) {
    assert.equal(transaction.transaction.signatures[0], pending.signature, 'Pending transaction signature mismatch.');
    assert(transaction.transaction.message.getAccountKeys().get(0)?.equals(payer), 'Pending transaction payer mismatch.');
    const before = transaction.meta.preBalances[0];
    const after = transaction.meta.postBalances[0];
    assert(Number.isSafeInteger(before) && Number.isSafeInteger(after) && before >= 0 && after >= 0,
      'Pending transaction payer balances are not safe integers.');
    const debit = BigInt(before) - BigInt(after);
    if (debit > 0n) budget.spentLamports = (budget.spentLamports ?? 0n) + debit;
    budget.pending = undefined;
    return;
  }
  if (!status && await connection.getBlockHeight('confirmed') > pending.lastValidBlockHeight) {
    budget.pending = undefined;
    return;
  }
  throw new Error('Previous transaction outcome is unresolved; no new write is allowed.');
}

export function assertBudgetRoom(budget: RehearsalBudget): void {
  assert(!budget.pending, 'Previous transaction outcome is unresolved; no new write is allowed.');
  assert((budget.spentLamports ?? 0n) < 500_000_000n, 'Stopped at the 0.5 test SOL spend boundary.');
}

/** Persist public evidence before the first (and only) submission attempt. */
export async function submitSignedTransaction(
  connection: Pick<Connection, 'sendRawTransaction'>,
  transaction: Transaction,
  recordSignature: (signature: string) => Promise<void>,
): Promise<string> {
  assert(transaction.signature, 'Transaction must be signed before submission.');
  const signature = bs58.encode(transaction.signature);
  const bytes = transaction.serialize();
  await recordSignature(signature);
  const returned = await connection.sendRawTransaction(bytes, {
    skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2,
  });
  assert.equal(returned, signature, 'RPC returned a different transaction signature.');
  return signature;
}

type InspectionStep = 'pool-created' | 'resume-start' | 'threshold-reached' | 'migration-verified';

export function assertInspectionSnapshot(
  value: unknown, expectedPoolAddress: string, expectedStage: InspectionReport['launch']['stage'],
  expectedDammPoolAddress?: string,
): asserts value is InspectionReport {
  if (!isReport(value)) throw new Error('Inspection snapshot is not a valid LaunchCheck v1 report.');
  if (value.source !== 'live' || value.cluster !== 'devnet' || value.pool.address !== expectedPoolAddress || value.launch.stage !== expectedStage) {
    throw new Error('Inspection snapshot does not match the created live devnet pool.');
  }
  if (expectedDammPoolAddress && (value.migration.verified !== true || value.migration.dammPoolAddress !== expectedDammPoolAddress)) {
    throw new Error('Inspection snapshot does not confirm the expected migrated DAMM v2 pool.');
  }
}

// This is a separate operational test artifact, never an InspectionReport or demo.
export async function runRehearsal(options: RehearsalOptions = {}): Promise<boolean> {
  const evidence: Evidence = {
    schemaVersion: 1, kind: 'devnet-test-rehearsal', startedAt: new Date().toISOString(),
    status: 'running', stage: 'genesis-check', addresses: {}, inspectionReports: [], transactions: [], checks: {},
    limitations: [
      'Fresh, deliberately small devnet test configuration; not a replay or validation of any mainnet configuration.',
      'Devnet programs, liquidity, rent and execution conditions can differ from mainnet.',
      'No assertion of market demand, token safety, profitability, or production readiness.',
      'Only the payer public address is recorded in evidence; the private key is never serialized here.',
      'A fresh attempt creates config and mint accounts. Resume validates an existing pool; prior trades require separately verified receipts.',
      'Derived addresses do not prove account creation; consult the confirmed transaction list.',
    ],
  };
  const artifact = resolve('artifacts', `rehearsal-${evidence.startedAt.replace(/[:.]/g, '-')}.json`);
  const save = async () => {
    await mkdir(resolve('artifacts'), { recursive: true });
    await writeFile(artifact, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  };
  let connection: Connection;
  const waitForTransaction = async (step: string, signature: string) => {
    let record = evidence.transactions.find(item => item.signature === signature);
    if (!record) {
      record = { step, signature, confirmed: false };
      evidence.transactions.push(record);
    }
    await save();
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus || '')) {
        record.confirmed = true;
        record.slot = status.slot;
        await save();
        console.log(`${step}: confirmed ${signature}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1_500));
    }
    throw new Error(`Confirmation not observed within 45s for ${step}; inspect recorded signature before rerunning.`);
  };

  try {
    const rpcUrl = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
    connection = new Connection(rpcUrl, {
      commitment: 'confirmed', disableRetryOnRateLimit: true,
      fetch: createRpcFetch({ timeoutMs: 15_000 }),
    });
    await requireDevnet(connection);
    evidence.genesisHash = DEVNET_GENESIS;
    console.log('Verified Solana devnet genesis. Mainnet writes are prohibited.');
    const payer = options.payer ?? loadPersistentDevnetKeypair();
    const resumePool = options.resumePool ?? process.env.DEVNET_RESUME_POOL;
    const resumeEvidencePath = options.resumeEvidence ?? process.env.DEVNET_RESUME_EVIDENCE;
    assert(!resumeEvidencePath || resumePool, 'Resume evidence requires a resume pool.');
    evidence.payer = payer.publicKey.toBase58();
    const budget = options.budget ?? {};
    await reconcileBudget(connection, payer.publicKey, budget);
    assertBudgetRoom(budget);
    evidence.checks.cumulativePayerSpendLamports = (budget.spentLamports ?? 0n).toString();
    if (resumeEvidencePath) {
      evidence.stage = 'verify-prior-trades';
      const previous: unknown = JSON.parse(await readFile(resolve(resumeEvidencePath), 'utf8'));
      assertTradeResumeEvidence(previous, resumePool!, payer.publicKey.toBase58());
      let priorSpend = 0n;
      for (const tx of previous.transactions) {
        const receipt = await connection.getTransaction(tx.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        assert(receipt?.meta && !receipt.meta.err, 'Prior trade is not confirmed successfully on-chain.');
        const keys = receipt.transaction.message.getAccountKeys();
        assert(receipt.transaction.signatures[0] === tx.signature && keys.get(0)?.equals(payer.publicKey) &&
          Array.from({ length: keys.length }, (_, i) => keys.get(i)?.toBase58()).includes(resumePool!),
        'Prior trade receipt does not match this pool and payer.');
        const before = receipt.meta.preBalances[0], after = receipt.meta.postBalances[0];
        assert(Number.isSafeInteger(before) && Number.isSafeInteger(after), 'Prior trade balances exceed safe integer precision.');
        if (before > after) priorSpend += BigInt(before) - BigInt(after);
        evidence.checks[`prior-${tx.step}`] = tx.signature;
      }
      budget.spentLamports = priorSpend > (budget.spentLamports ?? 0n) ? priorSpend : budget.spentLamports;
      assertBudgetRoom(budget);
      evidence.checks.cumulativePayerSpendLamports = (budget.spentLamports ?? 0n).toString();
      evidence.checks.priorTradeEvidence = relative(process.cwd(), resolve(resumeEvidencePath));
      evidence.limitations.push('Buy and sell were executed in the referenced prior run and verified from chain receipts, not repeated in this run.');
    }
    const configKeypair = resumePool ? null : Keypair.generate();
    const mintKeypair = resumePool ? null : Keypair.generate();
    const dbc = new DynamicBondingCurveClient(connection, 'confirmed');
    const cp = new CpAmm(connection);
    let config: PublicKey;
    let baseMint: PublicKey;
    let pool: PublicKey;
    if (resumePool) {
      pool = new PublicKey(resumePool);
      assert(pool.toBase58() === resumePool, 'Resume pool address must be canonical.');
      evidence.stage = 'validate-resume-pool';
      await save();
      const poolInfo = await connection.getAccountInfo(pool);
      assert(poolInfo?.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID), 'Resume pool is missing or has the wrong owner.');
      const state = await dbc.state.getPool(pool);
      assert(state, 'Resume pool could not be decoded.');
      config = state.poolState.config;
      baseMint = state.poolState.baseMint;
      const configInfo = await connection.getAccountInfo(config);
      assert(configInfo?.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID), 'Resume config is missing or has the wrong owner.');
      const stateConfig = await dbc.state.getPoolConfig(config);
      assert(stateConfig, 'Resume config could not be decoded.');
      assertResumeState(pool, state, stateConfig, await getMint(connection, baseMint), !!resumeEvidencePath);
      evidence.checks.reusedExistingPool = true;
      evidence.limitations.push('This run reuses an already confirmed devnet pool; its creation transactions are documented by the earlier rehearsal artifact, not claimed as transactions in this run.');
    } else {
      assert(configKeypair && mintKeypair);
      config = configKeypair.publicKey;
      baseMint = mintKeypair.publicKey;
      pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint, config);
      evidence.checks.reusedExistingPool = false;
    }
    const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[MigrationFeeOption.FixedBps100];
    const dammPool = deriveDammV2PoolAddress(dammConfig, baseMint, NATIVE_MINT);
    evidence.addresses = { config: config.toBase58(), baseMint: baseMint.toBase58(),
      quoteMint: NATIVE_MINT.toBase58(), dbcPool: pool.toBase58(), dammConfig: dammConfig.toBase58(),
      dammPool: dammPool.toBase58(), dbcProgram: DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58(),
      dammProgram: DAMM_V2_PROGRAM_ID.toBase58() };
    await save();

    evidence.stage = 'program-check';
    for (const program of [DYNAMIC_BONDING_CURVE_PROGRAM_ID, DAMM_V2_PROGRAM_ID]) {
      assert((await connection.getAccountInfo(program))?.executable, `Program unavailable on devnet: ${program}`);
    }
    evidence.checks.programAccountsExecutable = true;
    const dammConfigAccount = await connection.getAccountInfo(dammConfig);
    assert(dammConfigAccount?.owner.equals(DAMM_V2_PROGRAM_ID), 'DAMM migration config missing or wrong owner.');
    evidence.checks.migrationConfigOwnerVerified = true;

    evidence.stage = 'funding';
    await save();
    let startingBalance = await connection.getBalance(payer.publicKey);
    if (startingBalance < 500_000_000) {
      await requireDevnet(connection);
      if (options.waitForFunding ?? process.argv.includes('--wait-for-funding')) {
        console.log(`Fund the devnet-only payer ${payer.publicKey.toBase58()} with at least 0.5 test SOL: https://faucet.solana.com/`);
        await waitForFunding(() => connection.getBalance(payer.publicKey));
      } else {
        console.log('Requesting 1 test SOL from the devnet faucet.');
        const airdrop = await connection.requestAirdrop(payer.publicKey, 1_000_000_000);
        await waitForTransaction('devnet-airdrop', airdrop);
      }
      await requireDevnet(connection);
      startingBalance = await connection.getBalance(payer.publicKey);
    }
    assert(startingBalance >= 500_000_000, 'At least 0.5 devnet SOL is required for this test.');
    const send = async (step: string, tx: Transaction, additionalSigners: Keypair[] = []) => {
      evidence.stage = step;
      await save();
      // Guard every network write, including after a read or SDK operation has failed.
      await requireDevnet(connection);
      await reconcileBudget(connection, payer.publicKey, budget);
      assertBudgetRoom(budget);
      tx.feePayer = payer.publicKey;
      const block = await connection.getLatestBlockhash();
      tx.recentBlockhash = block.blockhash;
      tx.sign(payer, ...additionalSigners);
      const signature = await submitSignedTransaction(connection, tx, async signature => {
        budget.pending = { signature, lastValidBlockHeight: block.lastValidBlockHeight, step };
        evidence.transactions.push({ step, signature, confirmed: false, ...block });
        await save();
      });
      try {
        await waitForTransaction(step, signature);
      } finally {
        await reconcileBudget(connection, payer.publicKey, budget);
        evidence.checks.cumulativePayerSpendLamports = (budget.spentLamports ?? 0n).toString();
        await save();
      }
    };
    const captureInspection = async (step: InspectionStep) => {
      const report = await inspectPool(pool.toBase58(), 'devnet', rpcUrl);
      const stage = step === 'pool-created' || step === 'resume-start' ? 'trading' : step === 'threshold-reached' ? 'migration-ready' : 'migrated';
      assertInspectionSnapshot(report, pool.toBase58(), stage, step === 'migration-verified' ? dammPool.toBase58() : undefined);
      const path = resolve('artifacts', `inspection-${evidence.startedAt.replace(/[:.]/g, '-')}-${step}.json`);
      await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
      evidence.inspectionReports.push({ step, path: relative(process.cwd(), path) });
      await save();
      console.log(`Inspection snapshot (${step}): ${relative(process.cwd(), path)}`);
    };
    if (!resumePool) {
      assert(configKeypair && mintKeypair);
      const curve = testCurve();
      validateConfigParameters({ ...curve, leftoverReceiver: payer.publicKey });
      await send('create-config', await dbc.partner.createConfig({ ...curve, config,
        payer: payer.publicKey, feeClaimer: payer.publicKey, leftoverReceiver: payer.publicKey,
        quoteMint: NATIVE_MINT }), [configKeypair]);
      await send('create-pool', await dbc.creator.createPool({ config, baseMint,
        payer: payer.publicKey, poolCreator: payer.publicKey,
        name: 'LaunchCheck Devnet Test', symbol: 'LCTEST', uri: 'https://example.invalid/launchcheck-devnet.json' }), [mintKeypair]);
    }
    await captureInspection(resumeEvidencePath ? 'resume-start' : 'pool-created');

    const readPool = async () => {
      const state = await dbc.state.getPool(pool);
      assert(state, 'DBC pool missing after creation.');
      const stateConfig = await dbc.state.getPoolConfig(config);
      assert(stateConfig, 'DBC config missing after creation.');
      assert(state.poolState.config.equals(config) && state.poolState.baseMint.equals(baseMint));
      assert(stateConfig.quoteMint.equals(NATIVE_MINT));
      return { state, stateConfig };
    };
    const dbcSwap = async (step: string, amount: BN, sell: boolean) => {
      evidence.stage = step;
      await save();
      const { state, stateConfig } = await readPool();
      const quote = dbc.pool.swapQuote({ virtualPool: state, config: stateConfig,
        amountIn: amount, swapBaseForQuote: sell, slippageBps: 100,
        currentPoint: await getCurrentPoint(connection, stateConfig.activationType),
        hasReferral: false, eligibleForFirstSwapWithMinFee: false });
      assert(quote.minimumAmountOut.gt(new BN(0)), 'DBC quote returned no positive minimum output.');
      await send(step, await dbc.pool.swap({ owner: payer.publicKey, pool, amountIn: amount,
        minimumAmountOut: quote.minimumAmountOut, swapBaseForQuote: sell, referralTokenAccount: null }));
    };
    const baseAta = getAssociatedTokenAddressSync(baseMint, payer.publicKey);
    if (!resumeEvidencePath) {
      await dbcSwap('dbc-buy', new BN(20_000_000), false);
      const afterBuy = (await getAccount(connection, baseAta)).amount;
      assert(afterBuy > 0n, 'DBC buy did not deliver base tokens.');
      await dbcSwap('dbc-sell', new BN((afterBuy / 10n).toString()), true);
      assert((await getAccount(connection, baseAta)).amount < afterBuy, 'DBC sell did not debit base tokens.');
    }
    evidence.stage = 'dbc-graduate';
    await save();
    const { state, stateConfig } = await readPool();
    const { swapParams } = prepareGraduationSwap(dbc.pool, pool, payer.publicKey, state, stateConfig,
      await getCurrentPoint(connection, stateConfig.activationType));
    await send('dbc-graduate', await dbc.pool.swap2(swapParams));
    const graduated = await readPool();
    assert(graduated.state.poolState.quoteReserve.gte(graduated.stateConfig.migrationQuoteThreshold), 'Threshold was not reached.');
    evidence.checks.thresholdReached = true;
    evidence.checks.migrationThresholdLamports = graduated.stateConfig.migrationQuoteThreshold.toString();
    await captureInspection('threshold-reached');

    evidence.stage = 'migrate-damm-v2';
    await save();
    const migration = await dbc.migration.migrateToDammV2({ pool, dammConfig, payer: payer.publicKey });
    await send('migrate-damm-v2', migration.transaction,
      [migration.firstPositionNftKeypair, migration.secondPositionNftKeypair]);
    assert.equal((await readPool()).state.poolState.isMigrated, 1, 'DBC migration flag is not set.');
    assert((await connection.getAccountInfo(dammPool))?.owner.equals(DAMM_V2_PROGRAM_ID), 'DAMM pool has wrong owner.');
    const dammState = await cp.fetchPoolState(dammPool);
    assert(dammState.tokenAMint.equals(baseMint) && dammState.tokenBMint.equals(NATIVE_MINT), 'DAMM mints do not match the DBC launch.');
    const base = await getMint(connection, baseMint);
    assert.equal(base.decimals, 6);
    evidence.checks.migrationVerified = true;
    await captureInspection('migration-verified');

    evidence.stage = 'damm-v2-buy';
    await save();
    const amountIn = new BN(1_000_000);
    const slot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(slot);
    assert(blockTime !== null, 'Cannot determine chain time for DAMM quote.');
    const quote = cp.getQuote({ inAmount: amountIn, inputTokenMint: NATIVE_MINT,
      slippage: 1, poolState: dammState, currentTime: blockTime, currentSlot: slot,
      tokenADecimal: 6, tokenBDecimal: 9, hasReferral: false });
    assert(quote.minSwapOutAmount.gt(new BN(0)), 'DAMM quote returned no positive minimum output.');
    const beforeDammBuy = (await getAccount(connection, baseAta)).amount;
    await send('damm-v2-buy', await cp.swap({ payer: payer.publicKey, pool: dammPool,
      inputTokenMint: NATIVE_MINT, outputTokenMint: baseMint, amountIn,
      minimumAmountOut: quote.minSwapOutAmount, tokenAMint: dammState.tokenAMint,
      tokenBMint: dammState.tokenBMint, tokenAVault: dammState.tokenAVault,
      tokenBVault: dammState.tokenBVault, tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID, referralTokenAccount: null, poolState: dammState }));
    const delivered = (await getAccount(connection, baseAta)).amount - beforeDammBuy;
    assert(delivered >= BigInt(quote.minSwapOutAmount.toString()), 'DAMM swap balance delta is below minimum output.');
    evidence.checks.dammSwapVerified = true;
    evidence.checks.dammSwapBaseReceived = delivered.toString();
    evidence.status = 'passed';
    evidence.stage = 'complete';
  } catch (error) {
    evidence.status = 'failed';
    // Never serialize SDK error objects or an environment-supplied secret/endpoint.
    let message = error instanceof Error ? error.message : 'Unknown operation failure.';
    for (const sensitive of [process.env.DEVNET_KEYPAIR_JSON, process.env.DEVNET_RPC_URL]) {
      if (sensitive) message = message.replaceAll(sensitive, '[redacted]');
    }
    evidence.error = /https?:|wss?:|secret|keypair|key array/i.test(message)
      ? 'Operation failed; no successful end-to-end claim. Check the failing stage.' : message.slice(0, 500);
    console.error(`Rehearsal FAILED at ${evidence.stage}: ${evidence.error}`);
  } finally {
    evidence.completedAt = new Date().toISOString();
    await save();
    console.log(`Evidence: ${artifact}`);
    console.log(`End-to-end: ${evidence.status.toUpperCase()}`);
  }
  return evidence.status === 'passed';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runRehearsal() ? 0 : 1;
}
