# Public demo deployment

LaunchCheck serves its built React UI and read-only API from one Node.js process. Build the image from this directory:

```sh
docker build -t launchcheck:demo .
docker run --rm -p 8080:4174 launchcheck:demo
```

Open `http://localhost:8080` and check `http://localhost:8080/api/health`. The container listens on `0.0.0.0:4174`; outside Docker, `npm start` listens on `127.0.0.1:4174` by default. `HOST` selects the bind address and `PORT` accepts integers from 1 to 65535, including a hosting provider's port 80. A hosted process that must accept traffic directly should use `HOST=0.0.0.0` and the provider's assigned `PORT`. Keep the default loopback binding for local use.

Set `SOLANA_MAINNET_RPC_URL` and `SOLANA_DEVNET_RPC_URL` in the hosting provider's runtime environment if dedicated RPC endpoints are needed. Without them, the app uses public Solana endpoints. Keep provider credentials out of build arguments, frontend `VITE_` variables, source files, and the Docker image. The Docker build context includes only the package manifests, build config, HTML entry point, application source, and the runtime guard script; it excludes local `.env*` files, artifacts, rehearsal scripts, tests, and keys.

Route public HTTPS traffic to the container port and forward the original `Host` header. The browser and API use one origin, and the API compares the browser's `Origin` with `Host`. Do not rewrite `Host` to an internal service name. Configure TLS and public request limits at the hosting edge. The app does not use `X-Forwarded-For` to identify callers. Its application rate limit sees all visitors behind the proxy as one client, so put a per-client limit at the trusted edge and budget for the shared application limit. Set the hosting health check to `GET /api/health` and allow outbound HTTPS to the chosen Solana RPC endpoints.

The repository's [security notes](../SECURITY.md) record five high-severity audit findings from the unresolved `bigint-buffer` advisory. The public server starts with Node's native addons disabled and a runtime guard; this mitigates the native path but does not fix the dependency. This deployment is for a time-limited, read-only hackathon demo; review the residual risk and monitor traffic before exposing it publicly. No wallet or transaction signing is part of the HTTP app.

## Vercel

Vercel serves the static Vite build from `dist` and routes `/api/*` to the serverless function at `api/index.ts`. `vercel.json` sets the Vite framework, `dist` output directory, API rewrite, and install/build commands. The `api/index.ts` handler checks the runtime before loading the application handler.

Use a Vercel **Hobby** project with **Node.js 22.x**. Set the install command to `npm ci --ignore-scripts --no-audit --no-fund`. Set the build command to `NODE_OPTIONS= npm run build`; this clears an inherited `NODE_OPTIONS` for the build process, where Rollup needs its normal runtime. Set `NODE_OPTIONS=--no-addons` in both the **Production** and **Preview** runtime environments. The deployed API checks that native addons are disabled before serving each function instance.

The current `.vercelignore` is an allowlist: it includes only the API entrypoint, required source and runtime guard files, and build manifests/configuration. Local environment files, keys, generated artifacts, tests, and rehearsal scripts are outside that list and are not sent as project source. Keep RPC credentials in Vercel runtime environment variables; never add them to build variables or frontend `VITE_` variables.

The app's in-process rate limit is per serverless function instance, not a global quota. Requests can reach separate instances with separate counters. Behind Vercel, the app may see a shared proxy IP rather than each visitor's address; do not describe its limit as per-user or globally coordinated. Any public edge limit must be configured separately. Public deployment and the live URL are still pending.
