import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertReadOnlyRuntime } from '../scripts/check-runtime';

type Handler = ReturnType<typeof import('../src/server/app').createHandler>;
let handlerPromise: Promise<Handler> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Vercel does not use npm start. Check before importing the SDK-backed handler.
  assertReadOnlyRuntime();

  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/index') {
    const routes = url.searchParams.getAll('__launchcheck_route');
    url.searchParams.delete('__launchcheck_route');
    const route = routes.length === 1 && /^[a-z]+$/.test(routes[0]) ? routes[0] : 'unknown';
    req.url = `/api/${route}${url.search}`;
  }

  handlerPromise ??= import('../src/server/app').then(({ createHandler }) => createHandler());
  await (await handlerPromise)(req, res);
}
