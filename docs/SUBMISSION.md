# LaunchCheck — Hackathon Submission Draft

## Short pitch (100 words)

LaunchCheck gives Meteora launchpad developers one place to inspect a DBC pool’s configuration, fees and recipients, reserves, lifecycle stage, and migration checks. It brings those account reads together in a report that follows a pool from curve trading through DAMM v2. Developers can save a JSON baseline and compare a later read to see which settings or state changed, instead of manually checking account pages. The prototype supports ordinary SPL base tokens quoted in WSOL and DAMM v2 migration. Its Devnet rehearsal finalized seven transactions across three runs, covering DBC trades, the migration threshold, migration, and a DAMM v2 buy.

## Longer description

LaunchCheck helps developers answer a narrow operational question: what does the chain currently show for this Meteora DBC pool, and how has that state changed since a saved snapshot? It reads pool, config, mint, reserve, fee, and migration accounts and builds a lifecycle passport from DBC trading through curve completion to a verified DAMM v2 pool. Checks are limited to facts available from the accounts read; unsupported or unknown facts remain explicit.

The MVP supports ordinary SPL base tokens quoted in WSOL and DAMM v2 as the migration target. It provides a live Mainnet or Devnet read, clearly separated sample states, JSON export, and same-pool/network/source snapshot comparison. Mainnet inspection is read-only. The original developer contribution is the combination of a lifecycle view, scoped evidence checks, and reproducible state comparison around the DBC-to-DAMM handoff.

The prototype has 58 passing tests and a successful production build. Its end-to-end Devnet evidence covers seven finalized transactions—config and pool creation, DBC buy and sell, reaching the migration threshold, migration, and a DAMM v2 buy—across three runs with recovery between them. Two existing Mainnet pools were also inspected read-only. These results establish a working prototype and lifecycle rehearsal, not adoption or production reliability.

The business hypothesis is that launchpad engineering and operations teams may value a repeatable, inspectable handoff record that helps them review pool configuration and migration state. Willingness to pay, user demand, and measurable operational savings have not been validated. LaunchCheck is not a new launchpad, token safety certification, token audit, or price predictor. It does not verify actual LP NFT ownership, position locks, vesting, or whether a DAMM pool is currently trading. The current dependency audit still reports five high findings related to `bigint-buffer`; production readiness is not claimed.

## Submission details — owner to complete

- **Owner / submitter:** [PENDING — owner name]
- **Team members:** [PENDING — names and roles, or “Solo”]
- **Project / repository URL:** [https://github.com/iaqool/launchcheck](https://github.com/iaqool/launchcheck)
- **Live demo URL:** [PENDING — no public deployment yet]
- **Demo video URL:** [PENDING — record and upload before submission]
- **Category / track:** [PENDING — select in submission form]

## Readiness notes

- Hackathon rules require English submission content. The linked original project documents remain in Russian; this file and [README.en.md](../README.en.md) are the English project summary.
- Working deadline recorded in the project specification: October 13, 2026 at 11:59 UTC+5 (October 12 at 23:59 Pacific Time). Verify the submission form before submitting.
- The 2–3 minute demo target is an internal recording plan, not a verified official video-length rule.
- The local Docker deployment passed. A Vercel Hobby project has been created, but public deployment is still pending; the live demo URL remains pending.
- The latest verified suite has 58 passing tests and the production build exited 0.

