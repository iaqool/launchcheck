import { Connection, PublicKey, type AccountInfo } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, unpackMint } from '@solana/spl-token';
import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DAMM_V2_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveClient,
  MigrationOption,
  TokenType,
  deriveDammV2PoolAddress,
  deriveDbcPoolAddress,
  type PoolConfig,
  type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import { CpAmm, type PoolState } from '@meteora-ag/cp-amm-sdk';
import type { Cluster, InspectionReport } from '../shared/report.js';
import { buildReportFromAccounts } from './checks.js';
import { createRpcFetch } from './rpc.js';

export type InspectionErrorCode =
  | 'INVALID_ADDRESS'
  | 'POOL_NOT_FOUND'
  | 'WRONG_OWNER'
  | 'CONFIG_NOT_FOUND'
  | 'UNSUPPORTED_POOL'
  | 'INVALID_ACCOUNT'
  | 'RPC_UNAVAILABLE';

export class InspectionError extends Error {
  constructor(public readonly code: InspectionErrorCode, message: string) {
    super(message);
    this.name = 'InspectionError';
  }
}

const GENESIS_HASH: Record<Cluster, string> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};

function rpcConnection(rpcUrl: string): Connection {
  try {
    return new Connection(rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
      fetch: createRpcFetch(),
    });
  } catch {
    throw new InspectionError('RPC_UNAVAILABLE', 'The configured RPC endpoint could not be opened.');
  }
}

async function readAccount(connection: Connection, key: PublicKey): Promise<{ info: AccountInfo<Buffer> | null; slot: number }> {
  try {
    const result = await connection.getAccountInfoAndContext(key, 'confirmed');
    return { info: result.value, slot: result.context.slot };
  } catch {
    throw new InspectionError('RPC_UNAVAILABLE', 'The RPC read failed or timed out.');
  }
}

function readMintDecimals(key: PublicKey, info: AccountInfo<Buffer> | null, label: string): number {
  if (!info) throw new InspectionError('INVALID_ACCOUNT', `${label} mint account is missing.`);
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) throw new InspectionError('UNSUPPORTED_POOL', `${label} mint is not an SPL Token mint.`);
  try {
    return unpackMint(key, info, TOKEN_PROGRAM_ID).decimals;
  } catch {
    throw new InspectionError('INVALID_ACCOUNT', `${label} mint account could not be decoded.`);
  }
}

/** Read-only inspection of one standard SPL / SOL DBC pool. rpcUrl must be selected by the server. */
export async function inspectPool(address: string, cluster: Cluster, rpcUrl: string): Promise<InspectionReport> {
  let poolKey: PublicKey;
  try {
    poolKey = new PublicKey(address);
    if (poolKey.toBase58() !== address) throw new Error('Non-canonical address');
  } catch {
    throw new InspectionError('INVALID_ADDRESS', 'Enter a canonical Solana pool address.');
  }
  const connection = rpcConnection(rpcUrl);
  let genesis: string;
  try {
    genesis = await connection.getGenesisHash();
  } catch {
    throw new InspectionError('RPC_UNAVAILABLE', 'The RPC network identity could not be verified.');
  }
  if (genesis !== GENESIS_HASH[cluster]) {
    throw new InspectionError('RPC_UNAVAILABLE', 'The configured RPC endpoint is on a different Solana cluster.');
  }
  const dbc = DynamicBondingCurveClient.create(connection, 'confirmed');
  const { info: poolInfo, slot } = await readAccount(connection, poolKey);
  if (!poolInfo) throw new InspectionError('POOL_NOT_FOUND', 'DBC pool account was not found on this cluster.');
  if (!poolInfo.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)) {
    throw new InspectionError('WRONG_OWNER', 'Account is not owned by the Meteora DBC program.');
  }
  let pool: VirtualPool;
  try {
    pool = dbc.state.program.coder.accounts.decode<VirtualPool>('virtualPool', poolInfo.data);
  } catch {
    try {
      dbc.state.program.coder.accounts.decode('transferHookPool', poolInfo.data);
      throw new InspectionError('UNSUPPORTED_POOL', 'Transfer-hook DBC pools are outside the supported SPL base scope.');
    } catch (error) {
      if (error instanceof InspectionError) throw error;
      throw new InspectionError('INVALID_ACCOUNT', 'DBC pool has an unsupported or invalid account layout.');
    }
  }
  const state = pool.poolState;
  const configKey = state.config;
  const { info: configInfo } = await readAccount(connection, configKey);
  if (!configInfo) throw new InspectionError('CONFIG_NOT_FOUND', 'DBC config account was not found.');
  if (!configInfo.owner.equals(DYNAMIC_BONDING_CURVE_PROGRAM_ID)) {
    throw new InspectionError('WRONG_OWNER', 'DBC config is not owned by the Meteora DBC program.');
  }
  let config: PoolConfig;
  try {
    config = dbc.state.program.coder.accounts.decode<PoolConfig>('poolConfig', configInfo.data);
  } catch {
    try {
      dbc.state.program.coder.accounts.decode('configWithTransferHook', configInfo.data);
      throw new InspectionError('UNSUPPORTED_POOL', 'Transfer-hook DBC configs are outside the supported SPL base scope.');
    } catch (error) {
      if (error instanceof InspectionError) throw error;
      throw new InspectionError('INVALID_ACCOUNT', 'DBC config has an unsupported or invalid account layout.');
    }
  }
  if (config.migrationOption !== MigrationOption.MET_DAMM_V2) {
    throw new InspectionError('UNSUPPORTED_POOL', 'This pool does not target DAMM v2.');
  }
  const feeConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[config.migrationFeeOption];
  if (!feeConfig) throw new InspectionError('UNSUPPORTED_POOL', 'Unknown DAMM v2 migration fee configuration.');
  if (!config.quoteMint.equals(NATIVE_MINT) || config.tokenType !== TokenType.SPLToken || state.poolType !== TokenType.SPLToken || config.quoteTokenFlag !== 0) {
    throw new InspectionError('UNSUPPORTED_POOL', 'Only SPL Token base pools with wrapped SOL quote are supported.');
  }
  if (!deriveDbcPoolAddress(config.quoteMint, state.baseMint, configKey).equals(poolKey)) {
    throw new InspectionError('INVALID_ACCOUNT', 'DBC pool address does not match its config and token mints.');
  }
  const [baseResult, quoteResult] = await Promise.all([
    readAccount(connection, state.baseMint),
    readAccount(connection, config.quoteMint),
  ]);
  const baseDecimals = readMintDecimals(state.baseMint, baseResult.info, 'Base');
  const quoteDecimals = readMintDecimals(config.quoteMint, quoteResult.info, 'Quote');
  if (baseDecimals !== config.tokenDecimal || quoteDecimals !== 9) {
    throw new InspectionError('INVALID_ACCOUNT', 'Mint decimals do not match the DBC configuration or wrapped SOL.');
  }

  let dammPoolAddress: string | null = null;
  let dammVerified: boolean | null = null;
  if (state.migrationProgress === 3 || state.isMigrated === 1) {
    const dammKey = deriveDammV2PoolAddress(feeConfig, state.baseMint, config.quoteMint);
    const { info: dammInfo } = await readAccount(connection, dammKey);
    dammVerified = false;
    if (dammInfo?.owner.equals(DAMM_V2_PROGRAM_ID)) {
      const damm = new CpAmm(connection);
      try {
        const dammState = damm._program.coder.accounts.decode<PoolState>('pool', dammInfo.data);
        // The DAMM pool layout has no config field. Its PDA binds the fee config,
        // and we also require the owning program, discriminator, and both mints.
        dammVerified = (
          (dammState.tokenAMint.equals(state.baseMint) && dammState.tokenBMint.equals(config.quoteMint)) ||
          (dammState.tokenBMint.equals(state.baseMint) && dammState.tokenAMint.equals(config.quoteMint))
        );
      } catch {
        dammVerified = false;
      }
    }
    if (dammVerified) dammPoolAddress = dammKey.toBase58();
  }
  return buildReportFromAccounts({
    address: poolKey.toBase58(),
    cluster,
    fetchedAt: new Date().toISOString(),
    slot,
    pool,
    config,
    quoteDecimals,
    dammPoolAddress,
    dammVerified,
  });
}
