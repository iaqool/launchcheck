# Public demo deployment

LaunchCheck serves its built React UI and read-only API from one Node.js process. Build the image from this directory:

```sh
docker build -t launchcheck:demo .
docker run --rm -p 8080:4174 launchcheck:demo
```

Open `http://localhost:8080` and check `http://localhost:8080/api/health`. The container listens on `0.0.0.0:4174`; outside Docker, `npm start` listens on `127.0.0.1:4174` by default. `HOST` selects the bind address and `PORT` accepts integers from 1 to 65535, including a hosting provider's port 80. A hosted process that must accept traffic directly should use `HOST=0.0.0.0` and the provider's assigned `PORT`. Keep the default loopback binding for local use.

Set `SOLANA_MAINNET_RPC_URL` and `SOLANA_DEVNET_RPC_URL` in the hosting provider's runtime environment if dedicated RPC endpoints are needed. Without them, the app uses public Solana endpoints. Keep provider credentials out of build arguments, frontend `VITE_` variables, source files, and the Docker image. The Docker build context includes only the package manifests, build config, HTML entry point, application source, and the runtime guard script; it excludes local `.env*` files, artifacts, rehearsal scripts, tests, and keys.

Route public HTTPS traffic to the container port and forward the original `Host` header. The browser and API use one origin, and the API compares the browser's `Origin` with `Host`. Do not rewrite `Host` to an internal service name. Configure TLS and public request limits at the hosting edge. The app does not use `X-Forwarded-For` to identify callers. Its application rate limit sees all visitors behind the proxy as one client, so put a per-client limit at the trusted edge and budget for the shared application limit. Set the hosting health check to `GET /api/health` and allow outbound HTTPS to the chosen Solana RPC endpoints.

The repository's [security notes](../SECURITY.md) record five high-severity audit findings from the unresolved `bigint-buffer` advisory. The public server starts with Node's native addons disabled and a runtime guard; this mitigates the native path but does not fix the dependency. This is a time-limited, read-only hackathon demo and is not production-ready. No wallet or transaction signing is part of the HTTP app.

## Vercel

Vercel serves the static Vite build from `dist` and routes `/api/*` to the serverless function at `api/index.ts`. `vercel.json` sets the Vite framework, `dist` output directory, API rewrite, and install/build commands. The `api/index.ts` handler checks the runtime before loading the application handler.

Use a Vercel **Hobby** project with **Node.js 22.x**. Set the install command to `npm ci --ignore-scripts --no-audit --no-fund`. Set the build command to `NODE_OPTIONS= npm run build`; this clears an inherited `NODE_OPTIONS` for the build process, where Rollup needs its normal runtime.

For both **Production** and **Preview**, set `NODE_OPTIONS=--no-addons --experimental-require-module`. The first flag keeps the native `bigint-buffer` addon disabled; the second enables Node 22's CommonJS `require()` of ES modules. Vercel disables this experimental Node feature by default, while the Solana `rpc-websockets` dependency's `uuid@14` path requires it. Without the second flag, the runtime can fail while loading that module. The [official Vercel Advanced Node.js Usage guide](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration#experimental-nodejs-require-of-es-module) documents the default and the environment variable used to enable it.

The build command intentionally clears `NODE_OPTIONS` only for `npm run build` so the Rollup bundler can use its normal runtime. The separate `api/index.ts` guard remains in place and still verifies that native addons are disabled when the function starts.

The current `.vercelignore` is an allowlist: it includes only the API entrypoint, required source and runtime guard files, and build manifests/configuration. Local environment files, keys, generated artifacts, tests, and rehearsal scripts are outside that list and are not sent as project source. Keep RPC credentials in Vercel runtime environment variables; never add them to build variables or frontend `VITE_` variables.

The app's in-process rate limit is per serverless function instance, not a global quota. Requests can reach separate instances with separate counters. Behind Vercel, the app may see a shared proxy IP rather than each visitor's address; do not describe its limit as per-user or globally coordinated. Any public edge limit must be configured separately.

The public demo is available at [launchcheck-one.vercel.app](https://launchcheck-one.vercel.app). It was deployed manually with the Vercel CLI to the Hobby project; to publish a later production revision, run `vercel deploy --prod --scope <team-scope>` from the repository. An anonymous smoke run verified HTTP 200 for health, sample, migrated Devnet inspection, and migrated Mainnet inspection; report comparison returned two changes in one check and four for the migrated Devnet lifecycle. This public demo remains a limited, read-only hackathon deployment; the unresolved five high `bigint-buffer` audit findings mean the project is not production-ready.

The persistent GitHub integration is not connected. A Git push alone does not deploy changes; publication currently uses the manual CLI command above.
