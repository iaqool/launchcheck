import type { ConnectionConfig } from '@solana/web3.js';

type RpcFetch = NonNullable<ConnectionConfig['fetch']>;

const nextRequestAt = new Map<string, number>();
const PUBLIC_RPC_HOSTS = new Set([
  'api.devnet.solana.com',
  'api.mainnet-beta.solana.com',
  'api.testnet.solana.com',
]);

function isRead(body: unknown): boolean {
  if (typeof body !== 'string') return false;
  try {
    const request: unknown = JSON.parse(body);
    const safe = (entry: unknown) => {
      if (!entry || typeof entry !== 'object' || !('method' in entry)) return false;
      const method = entry.method;
      return typeof method === 'string' &&
        (/^get[A-Z]/.test(method) || method === 'isBlockhashValid' || method === 'minimumLedgerSlot' || method === 'simulateTransaction');
    };
    return Array.isArray(request) ? request.length > 0 && request.every(safe) : safe(request);
  } catch {
    return false;
  }
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, Math.min(delay, 5_000)) : 0;
}

async function rpcCode429(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const payload: unknown = await response.clone().json();
    return !!payload && typeof payload === 'object' && 'error' in payload &&
      !!payload.error && typeof payload.error === 'object' && 'code' in payload.error &&
      payload.error.code === 429;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Pass as ConnectionConfig.fetch. Instances share a queue for public RPC hosts. */
export function createRpcFetch(options: {
  fetch?: RpcFetch;
  timeoutMs?: number;
  maxReadRetries?: number;
  minIntervalMs?: number;
} = {}): RpcFetch {
  const underlying = options.fetch ?? (globalThis.fetch as RpcFetch);
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxReadRetries = options.maxReadRetries ?? 2;
  return (async (input, init) => {
    const endpoint = typeof input === 'string' ? input : input.toString();
    const host = new URL(endpoint).hostname;
    const interval = options.minIntervalMs ?? (PUBLIC_RPC_HOSTS.has(host) ? 400 : 0);
    const read = isRead(init?.body);

    for (let attempt = 0; ; attempt++) {
      if (interval > 0) {
        const now = Date.now();
        const scheduled = Math.max(now, nextRequestAt.get(host) ?? now);
        nextRequestAt.set(host, scheduled + interval);
        if (scheduled > now) await sleep(scheduled - now);
      }

      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      const response = await underlying(input, { ...init, signal });
      if (!read || attempt >= maxReadRetries) return response;
      if (response.status !== 429 && !(await rpcCode429(response))) return response;

      const delay = Math.max(Math.min(500 * 2 ** attempt, 5_000), retryAfterMs(response as Response));
      await response.text().catch(() => undefined);
      await sleep(delay);
    }
  }) as RpcFetch;
}
