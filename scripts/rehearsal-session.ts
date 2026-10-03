import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Keypair } from '@solana/web3.js';
import type { RehearsalOptions } from './rehearsal';
import { loadPersistentDevnetKeypair } from './devnet-wallet';

let attemptNumber = 0;
export async function loadRehearsal(): Promise<(options: RehearsalOptions) => Promise<boolean>> {
  // Reload the entry script after a fix without restarting the process holding the payer.
  const module = await import(`./rehearsal.ts?attempt=${++attemptNumber}`);
  return module.runRehearsal;
}

export async function rehearsalSession(
  payer: Keypair,
  attempt: (options: RehearsalOptions) => Promise<boolean>,
  nextCommand: () => Promise<string>,
  log: (message: string) => void,
): Promise<void> {
  const options: RehearsalOptions = { payer, waitForFunding: true, budget: {} };
  let command = 'run';
  while (command !== 'exit') {
    if (command === 'run') {
      try { await attempt(options); }
      catch { log('Attempt stopped unexpectedly; the session still retains its payer. Check evidence.'); }
      log(`Session payer retained: ${payer.publicKey.toBase58()}`);
      log('Before another attempt, check unconfirmed signatures and the configured new-launch or resume mode.');
    }
    command = (await nextCommand()).trim().toLowerCase();
    if (!['run', 'exit'].includes(command)) log('Commands: run, exit.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const payer = loadPersistentDevnetKeypair();
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Devnet session: payer loaded from the configured environment. The local wallet can be reopened after process exit.');
  try {
    await rehearsalSession(payer, async options => (await loadRehearsal())(options),
      () => terminal.question('Type run to try again, or exit: '), console.log);
  } finally { terminal.close(); }
}
