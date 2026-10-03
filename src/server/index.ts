import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createHandler } from './app';

if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.PORT ?? 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const host = process.env.HOST ?? '127.0.0.1';
if (!host.trim()) throw new Error('HOST must be a non-empty address.');
const server = createServer(createHandler());
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(port, host, () => console.log(`LaunchCheck read-only server: http://${host}:${port}`));
