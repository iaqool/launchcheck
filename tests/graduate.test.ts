import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import BN from 'bn.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { DynamicBondingCurveClient, SwapMode, type PoolConfig, type VirtualPool } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { prepareGraduationSwap } from '../scripts/graduate';

type Fixture = { addresses: string[]; slot: number; accounts: { data: string }[] };
const fixture = JSON.parse(readFileSync(new URL('./fixtures/graduate-state.json', import.meta.url), 'utf8')) as Fixture;
const service = DynamicBondingCurveClient.create(new Connection('http://127.0.0.1:1')).pool;
const coder = service.getProgram().coder.accounts;
const state = coder.decode<VirtualPool>('virtualPool', Buffer.from(fixture.accounts[0].data, 'base64'));
const config = coder.decode<PoolConfig>('poolConfig', Buffer.from(fixture.accounts[1].data, 'base64'));
const pool = new PublicKey(fixture.addresses[0]);
const owner = new PublicKey(Uint8Array.from({ length: 32 }, () => 42));
const currentPoint = new BN(fixture.slot);

test('live post-buy/sell state rejects overshooting exact-in but partial fill reaches the boundary', () => {
  const remaining = config.migrationQuoteThreshold.sub(state.poolState.quoteReserve);
  const amountIn = remaining.muln(102).divn(100).addn(1_000);
  assert.throws(() => service.swapQuote2({ virtualPool: state, config, amountIn,
    swapBaseForQuote: false, swapMode: SwapMode.ExactIn, slippageBps: 100,
    currentPoint, hasReferral: false, eligibleForFirstSwapWithMinFee: false }), /Insufficient Liquidity/);

  const result = prepareGraduationSwap(service, pool, owner, state, config, currentPoint);
  assert.equal(result.swapParams.swapMode, SwapMode.PartialFill);
  assert.equal(result.swapParams.amountIn.toString(), '84843740');
  assert(result.quote.minimumAmountOut);
  assert.equal(result.swapParams.minimumAmountOut.toString(), result.quote.minimumAmountOut.toString());
  assert.equal(result.quote.amountLeft.toString(), '816144');
  assert.equal(state.poolState.quoteReserve.add(result.quote.excludedFeeInputAmount).toString(), '100000001');
  assert.equal(result.quote.nextSqrtPrice.toString(), config.migrationSqrtPrice.toString());
});

test('graduation preparation refuses a reached threshold or a quote that cannot reach it', () => {
  const completed = { ...state, poolState: { ...state.poolState,
    quoteReserve: config.migrationQuoteThreshold } } as VirtualPool;
  assert.throws(() => prepareGraduationSwap(service, pool, owner, completed, config, currentPoint), /already reached/);

  const valid = prepareGraduationSwap(service, pool, owner, state, config, currentPoint).quote;
  const badService = { swapQuote2: () => ({ ...valid, excludedFeeInputAmount: new BN(0) }) } as unknown as typeof service;
  assert.throws(() => prepareGraduationSwap(badService, pool, owner, state, config, currentPoint), /does not reach/);
});
