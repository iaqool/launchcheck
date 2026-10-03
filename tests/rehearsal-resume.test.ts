import assert from 'node:assert/strict';
import test from 'node:test';
import { Connection, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT, type Mint } from '@solana/spl-token';
import {
  DynamicBondingCurveClient, DynamicBondingCurveIdl, deriveDbcPoolAddress,
  type PoolConfig, type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { assertResumeState, assertTradeResumeEvidence, DEVNET_GENESIS, testCurve } from '../scripts/rehearsal';

const coder = DynamicBondingCurveClient.create(new Connection('http://127.0.0.1:1')).state.program.coder.accounts;
function emptyAccount<T>(name: 'virtualPool' | 'poolConfig'): T {
  const entry = DynamicBondingCurveIdl.accounts.find(account => account.name.toLowerCase() === name.toLowerCase());
  assert(entry);
  return coder.decode<T>(name, Buffer.concat([Buffer.from(entry.discriminator), Buffer.alloc(coder.size(name) - 8)]));
}

function emptyTestPool() {
  const expected = testCurve();
  assert(expected.tokenSupply);
  const configKey = new PublicKey(Uint8Array.from({ length: 32 }, () => 31));
  const baseMint = new PublicKey(Uint8Array.from({ length: 32 }, () => 32));
  const pool = deriveDbcPoolAddress(NATIVE_MINT, baseMint, configKey);
  const state = emptyAccount<VirtualPool>('virtualPool');
  state.poolState.config = configKey;
  state.poolState.baseMint = baseMint;
  const config = emptyAccount<PoolConfig>('poolConfig');
  config.quoteMint = NATIVE_MINT;
  config.quoteTokenFlag = expected.tokenType;
  config.tokenType = expected.tokenType;
  config.migrationOption = expected.migrationOption;
  config.migrationFeeOption = expected.migrationFeeOption;
  config.migrationQuoteThreshold = expected.migrationQuoteThreshold;
  config.sqrtStartPrice = expected.sqrtStartPrice;
  config.preMigrationTokenSupply = expected.tokenSupply.preMigrationTokenSupply;
  config.postMigrationTokenSupply = expected.tokenSupply.postMigrationTokenSupply;
  config.tokenDecimal = expected.tokenDecimal;
  config.collectFeeMode = expected.collectFeeMode;
  config.partnerPermanentLockedLiquidityPercentage = expected.partnerPermanentLockedLiquidityPercentage;
  config.partnerLiquidityPercentage = expected.partnerLiquidityPercentage;
  config.creatorPermanentLockedLiquidityPercentage = expected.creatorPermanentLockedLiquidityPercentage;
  config.creatorLiquidityPercentage = expected.creatorLiquidityPercentage;
  config.poolFees.baseFee.cliffFeeNumerator = expected.poolFees.baseFee.cliffFeeNumerator;
  config.poolFees.baseFee.baseFeeMode = expected.poolFees.baseFee.baseFeeMode;
  const mint = { decimals: expected.tokenDecimal,
    supply: BigInt(expected.tokenSupply.preMigrationTokenSupply.toString()) } as Mint;
  return { pool, state, config, mint };
}

test('resume accepts the empty pool with the exact rehearsal curve and mint supply', () => {
  const { pool, state, config, mint } = emptyTestPool();
  assert.doesNotThrow(() => assertResumeState(pool, state, config, mint));
});

test('resume rejects prior trading, changed curve, mint, or address before payer writes', () => {
  for (const change of [
    (sample: ReturnType<typeof emptyTestPool>) => { sample.state.poolState.hasSwap = 1; },
    (sample: ReturnType<typeof emptyTestPool>) => { sample.state.poolState.quoteReserve = sample.config.migrationQuoteThreshold; },
    (sample: ReturnType<typeof emptyTestPool>) => { sample.config.migrationQuoteThreshold = sample.config.migrationQuoteThreshold.addn(1); },
    (sample: ReturnType<typeof emptyTestPool>) => { sample.mint.supply -= 1n; },
    (sample: ReturnType<typeof emptyTestPool>) => { sample.pool = PublicKey.default; },
  ]) {
    const sample = emptyTestPool();
    change(sample);
    assert.throws(() => assertResumeState(sample.pool, sample.state, sample.config, sample.mint));
  }
});

test('verified trade resume permits trading state but refuses an already graduated pool', () => {
  const sample = emptyTestPool();
  sample.state.poolState.hasSwap = 1;
  sample.state.poolState.quoteReserve = sample.config.migrationQuoteThreshold.divn(5);
  assert.doesNotThrow(() => assertResumeState(sample.pool, sample.state, sample.config, sample.mint, true));
  sample.state.poolState.quoteReserve = sample.config.migrationQuoteThreshold;
  assert.throws(() => assertResumeState(sample.pool, sample.state, sample.config, sample.mint, true));
});

test('trade checkpoint refuses a different payer/pool, unconfirmed trades, or later submissions', () => {
  const previous = { schemaVersion: 1, kind: 'devnet-test-rehearsal', genesisHash: DEVNET_GENESIS,
    payer: 'expected-payer', addresses: { dbcPool: 'expected-pool' }, transactions: [
      { step: 'dbc-buy', signature: 'buy-signature', confirmed: true },
      { step: 'dbc-sell', signature: 'sell-signature', confirmed: true },
    ] };
  assert.doesNotThrow(() => assertTradeResumeEvidence(previous, 'expected-pool', 'expected-payer'));
  assert.throws(() => assertTradeResumeEvidence(previous, 'other-pool', 'expected-payer'));
  assert.throws(() => assertTradeResumeEvidence(previous, 'expected-pool', 'other-payer'));
  const unconfirmed = structuredClone(previous);
  unconfirmed.transactions[1].confirmed = false;
  assert.throws(() => assertTradeResumeEvidence(unconfirmed, 'expected-pool', 'expected-payer'));
  const later = structuredClone(previous);
  later.transactions.push({ step: 'dbc-graduate', signature: 'unknown', confirmed: false });
  assert.throws(() => assertTradeResumeEvidence(later, 'expected-pool', 'expected-payer'));
});
