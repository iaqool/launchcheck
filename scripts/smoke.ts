import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inspectPool } from '../src/core/inspect';
import { isReport } from '../src/shared/comparison';
import type { Cluster } from '../src/shared/report';

if (existsSync('.env')) process.loadEnvFile('.env');
const [address, cluster = 'mainnet-beta'] = process.argv.slice(2);
if (!address || !['mainnet-beta', 'devnet'].includes(cluster)) {
  console.error('Usage: npm run smoke -- <DBC pool address> [mainnet-beta|devnet]');
  process.exitCode = 1;
} else {
  const rpc = cluster === 'devnet' ? process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com'
    : process.env.SOLANA_MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  try {
    const report = await inspectPool(address, cluster as Cluster, rpc);
    if (!isReport(report)) throw new Error('Inspector output does not satisfy the shared report contract.');
    await mkdir('artifacts', { recursive: true });
    const path = `artifacts/smoke-${cluster}-${address}.json`;
    await writeFile(path, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ source: report.source, cluster: report.cluster, pool: address,
      stage: report.launch.stage, reserve: report.pool.quoteReserve,
      threshold: report.pool.migrationThreshold, checks: report.checks.map(c => ({ id: c.id, status: c.status })), artifact: path }, null, 2));
  } catch (error) {
    // Inspector errors are sanitized; unexpected SDK details/endpoint URLs stay out of logs.
    const known = error && typeof error === 'object' && 'code' in error;
    console.error(known && error instanceof Error ? error.message : 'Smoke inspection failed.');
    process.exitCode = 1;
  }
}
