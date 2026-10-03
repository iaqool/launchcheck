import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { inspectPool } from '../core/inspect';
import { demoReport } from './demo';
import { compareReports } from '../shared/comparison';
import type { Cluster } from '../shared/report';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function fail(res: ServerResponse, status: number, code: string, message: string) { json(res, status, { error: { code, message } }); }

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error('Request is too large. Maximum JSON size is 512 KB.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createHandler(inspector = inspectPool, distPath = resolve('dist')) {
  const rates = new Map<string, { count: number; until: number }>();
  let activeInspections = 0;
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        // Browser requests arrive via the same-origin Vite proxy or this server.
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) {
          fail(res, 403, 'ORIGIN_REJECTED', 'Use LaunchCheck from the same origin as its API.'); return;
        }
        // Health probes must remain available after API clients exhaust their quota.
        if (url.pathname === '/api/health' && req.method === 'GET') { json(res, 200, { status: 'ok', version: '0.1.0', mode: 'read-only' }); return; }
        const ip = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        for (const [key, rate] of rates) if (rate.until <= now) rates.delete(key);
        const rate = rates.get(ip) ?? { count: 0, until: now + 60000 };
        if (rates.size >= 1000 && !rates.has(ip)) { fail(res, 429, 'RATE_LIMIT', 'Too many clients. Try again in a minute.'); return; }
        rate.count++;
        rates.set(ip, rate);
        if (rate.count > 60) { res.setHeader('Retry-After', '60'); fail(res, 429, 'RATE_LIMIT', 'Too many requests. Try again in a minute.'); return; }
      }
      if (url.pathname === '/api/demo' && req.method === 'GET') {
        const scenario = url.searchParams.get('scenario') ?? 'trading';
        if (!['trading', 'pending', 'migrated'].includes(scenario)) { fail(res, 400, 'INVALID_SCENARIO', 'Choose trading, pending or migrated.'); return; }
        json(res, 200, demoReport(scenario)); return;
      }
      if (url.pathname === '/api/inspect' && req.method === 'GET') {
        const address = (url.searchParams.get('address') ?? '').trim();
        const cluster = url.searchParams.get('cluster') ?? 'mainnet-beta';
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) { fail(res, 400, 'INVALID_ADDRESS', 'Enter a valid Solana DBC pool address.'); return; }
        if (!['mainnet-beta', 'devnet'].includes(cluster)) { fail(res, 400, 'INVALID_CLUSTER', 'Choose mainnet-beta or devnet.'); return; }
        if (activeInspections >= 4) { fail(res, 429, 'BUSY', 'Four inspections are already running. Try again shortly.'); return; }
        const rpc = cluster === 'devnet' ? process.env.SOLANA_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com'
          : process.env.SOLANA_MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
        let rpcValid = false;
        try { rpcValid = ['https:', 'http:'].includes(new URL(rpc).protocol); } catch { /* Never return the configured URL. */ }
        if (!rpcValid) { fail(res, 503, 'RPC_CONFIGURATION', 'The server RPC endpoint is not configured correctly.'); return; }
        activeInspections++;
        try { json(res, 200, await inspector(address, cluster as Cluster, rpc)); }
        catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
          const known = ['INVALID_ADDRESS', 'POOL_NOT_FOUND', 'WRONG_OWNER', 'CONFIG_NOT_FOUND', 'UNSUPPORTED_POOL', 'RPC_UNAVAILABLE', 'INVALID_ACCOUNT'];
          if (known.includes(code) && error instanceof Error) {
            const status = code === 'RPC_UNAVAILABLE' ? 503 : code.endsWith('NOT_FOUND') ? 404 : 422;
            fail(res, status, code, error.message);
          } else fail(res, 502, 'INSPECTION_FAILED', 'The pool could not be inspected. Check the address and try again.');
        } finally { activeInspections--; }
        return;
      }
      if (url.pathname === '/api/compare' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) { fail(res, 415, 'JSON_REQUIRED', 'Send application/json.'); return; }
        try {
          const input = await body(req);
          if (!input || typeof input !== 'object' || !('baseline' in input) || !('current' in input)) throw new Error('Provide baseline and current LaunchCheck reports.');
          json(res, 200, compareReports(input.baseline, input.current));
        } catch (error) {
          const message = error instanceof SyntaxError ? 'The file is not valid JSON.' : error instanceof Error ? error.message : 'Invalid report.';
          fail(res, 400, 'INVALID_COMPARISON', message);
        }
        return;
      }
      if (url.pathname.startsWith('/api/')) { fail(res, 404, 'NOT_FOUND', 'API route or method not found.'); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      let pathname: string;
      try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
      const root = resolve(distPath);
      const file = resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
      const requestedFile = pathname === '/' ? resolve(root, 'index.html') : file;
      const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      try {
        const content = await readFile(requestedFile);
        res.writeHead(200, { 'Content-Type': mime[extname(requestedFile)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Build LaunchCheck with npm run build, or use npm run dev.'); }
    } catch { if (!res.headersSent) fail(res, 500, 'SERVER_ERROR', 'The request could not be processed.'); else res.end(); }
  };
}
