# LaunchCheck

[Русский](README.ru.md) · [Submission draft](docs/SUBMISSION.md) · [Deployment notes](docs/DEPLOYMENT.md)

**Live demo:** [launchcheck-one.vercel.app](https://launchcheck-one.vercel.app) · **Repository:** [iaqool/launchcheck](https://github.com/iaqool/launchcheck)

LaunchCheck is a read-only lifecycle passport for Meteora Dynamic Bonding Curve (DBC) pools targeting DAMM v2. It reads pool, config, mint, reserve, fee, and migration accounts, then presents the observed lifecycle stage, evidence-based checks, and a JSON snapshot that can be compared with a later read. It is a developer inspection tool, not a launchpad, security certification, token audit, or price predictor.

## Run locally

Requires Node.js 22 and npm.

```powershell
npm ci --ignore-scripts
npm run build
npm start
```

The install command skips dependency lifecycle scripts. `npm start` runs the server through a Node.js `--no-addons` runtime check before opening the local HTTP listener; this mitigates the native `bigint-buffer` path described below, but does not remove the dependency advisory.

Open `http://127.0.0.1:4174`. For the Vite development server, run `npm run dev` and open `http://127.0.0.1:5173`; keep the backend on port 4174.

The server can read `.env` from the project root. Copy `.env.example` to `.env` to configure `SOLANA_MAINNET_RPC_URL`, `SOLANA_DEVNET_RPC_URL`, or `PORT`. RPC credentials belong only in server environment variables; do not prefix them with `VITE_`. If an RPC URL is omitted, the public Solana endpoint is used.

## Inspect and compare

Enter a DBC pool address and select Mainnet or Devnet. A successful network read is labelled **LIVE READ**. The three built-in examples are labelled **SAMPLE DATA**; an RPC error is never replaced by a sample. Export a report as JSON, then import it as a baseline to compare a later report for the same pool, network, and source. Imported JSON is user-provided and unsigned, not independently authenticated.

The confirmed scope is ordinary SPL base tokens quoted in WSOL and migration to DAMM v2. The report displays configured liquidity allocation, but does not establish actual LP NFT ownership, position locks, or vesting. A DAMM account check confirms account existence and mint matching, not current trading activity. Other token families and migration configurations are outside the confirmed scope.

## Checks and evidence

```powershell
npm test
npm run smoke -- <DBC-pool-address> [mainnet-beta|devnet]
```

The verified suite has 58 passing tests; `npm run build` completed successfully. Two existing mainnet pools were inspected read-only. A seven-transaction devnet lifecycle was finalized across three runs, covering DBC buy/sell, threshold, migration, and DAMM v2 buy. An anonymous smoke check of the published app returned HTTP 200 for health, sample, and live inspection routes. Report comparison returned two changes in one check and four when comparing the migrated Devnet pool. See [verification details](VERIFICATION.md), [English devnet transaction evidence](docs/DEVNET-PROOF.en.md), and the [original devnet proof](DEVNET-PROOF.md).

## Security status

Mainnet inspection does not connect a wallet, sign, or send transactions. The separate rehearsal tooling can submit test transactions to Devnet. The latest recorded `npm audit` result is **5 high, 0 moderate, 0 critical**, all associated with the unresolved `bigint-buffer` advisory. Reachability checks found fixed-length buffers on the reviewed SPL paths, but this does not establish SDK-wide safety. The project is not production-ready; see [SECURITY.md](SECURITY.md) for scope and details.

For container and hosting setup, including bind address, forwarded `Host` header, TLS, rate limits, and health checks, see [deployment notes](docs/DEPLOYMENT.md). The site is published on Vercel Hobby and is not described as production-ready.

## Original project documents

- [Project specification (Russian)](SPEC.md)
- [Verification log (Russian)](VERIFICATION.md)
- [Devnet proof and transaction links (Russian)](DEVNET-PROOF.md)
- [Dependency security analysis (Russian)](SECURITY.md)

