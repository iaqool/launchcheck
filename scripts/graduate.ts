import assert from 'node:assert/strict';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { SwapMode, type DynamicBondingCurveClient, type PoolConfig, type Swap2Params, type VirtualPool } from '@meteora-ag/dynamic-bonding-curve-sdk';

/** Quote a capped buy at the migration price; excess SOL is left unspent by swap2. */
export function prepareGraduationSwap(
  service: Pick<DynamicBondingCurveClient['pool'], 'swapQuote2'>,
  pool: PublicKey,
  owner: PublicKey,
  state: VirtualPool,
  config: PoolConfig,
  currentPoint: BN,
): { quote: ReturnType<DynamicBondingCurveClient['pool']['swapQuote2']>; swapParams: Swap2Params } {
  const remaining = config.migrationQuoteThreshold.sub(state.poolState.quoteReserve);
  assert(remaining.gt(new BN(0)), 'DBC pool already reached its migration threshold.');
  const amountIn = remaining.muln(102).divn(100).addn(1_000);
  const quote = service.swapQuote2({ virtualPool: state, config,
    amountIn, swapBaseForQuote: false, swapMode: SwapMode.PartialFill, slippageBps: 100,
    currentPoint, hasReferral: false, eligibleForFirstSwapWithMinFee: false });
  const minimumAmountOut = quote.minimumAmountOut;
  if (!minimumAmountOut || !minimumAmountOut.gt(new BN(0))) {
    throw new Error('Graduation quote returned no positive minimum output.');
  }
  assert(quote.nextSqrtPrice.eq(config.migrationSqrtPrice) &&
    state.poolState.quoteReserve.add(quote.excludedFeeInputAmount).gte(config.migrationQuoteThreshold),
  'Graduation quote does not reach the configured migration boundary.');
  return { quote, swapParams: { owner, pool, amountIn, minimumAmountOut,
    swapBaseForQuote: false, swapMode: SwapMode.PartialFill, referralTokenAccount: null } };
}
