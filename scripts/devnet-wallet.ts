import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { Keypair } from '@solana/web3.js';

const walletFile = resolve('.env.devnet.local');

export function loadDevnetKeypair(json: string | undefined): Keypair {
  if (!json) return Keypair.generate();
  try {
    const bytes: unknown = JSON.parse(json);
    if (!Array.isArray(bytes) || bytes.length !== 64 ||
      !bytes.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) throw new Error();
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new Error('DEVNET_KEYPAIR_JSON must contain a valid 64-byte Solana secret key array.');
  }
}

/** An externally supplied environment value takes precedence over the local env file. */
export function loadPersistentDevnetKeypair(
  file = walletFile, environment: Record<string, string | undefined> = process.env,
): Keypair {
  let secret = environment.DEVNET_KEYPAIR_JSON;
  if (secret === undefined) {
    try { secret = parseEnv(readFileSync(file, 'utf8')).DEVNET_KEYPAIR_JSON; }
    catch { throw new Error('No readable devnet wallet environment. Run npm run devnet:wallet first.'); }
  }
  if (!secret) throw new Error('DEVNET_KEYPAIR_JSON is missing. Run npm run devnet:wallet first.');
  const payer = loadDevnetKeypair(secret);
  environment.DEVNET_KEYPAIR_JSON = secret;
  return payer;
}

/** Create once; never replace an existing wallet or expose its secret in output. */
export function prepareDevnetWallet(
  file = walletFile, environment: Record<string, string | undefined> = process.env,
): string {
  if (environment.DEVNET_KEYPAIR_JSON !== undefined) {
    return loadPersistentDevnetKeypair(file, environment).publicKey.toBase58();
  }
  const payer = Keypair.generate();
  try {
    writeFileSync(file, `DEVNET_KEYPAIR_JSON=${JSON.stringify(Array.from(payer.secretKey))}\n`, {
      flag: 'wx', mode: 0o600, flush: true,
    });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) {
      throw new Error('Could not create the local devnet environment file; no funding address was issued.');
    }
  }
  // Read back the stored value before publishing the funding address.
  return loadPersistentDevnetKeypair(file, environment).publicKey.toBase58();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(`Devnet payer: ${prepareDevnetWallet()}`);
    console.log('Wallet loaded from DEVNET_KEYPAIR_JSON or .env.devnet.local. Keep the local environment file private.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Devnet wallet setup failed.');
    process.exitCode = 1;
  }
}
