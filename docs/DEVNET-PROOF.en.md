# LaunchCheck Devnet lifecycle evidence

On October 3, 2026, all seven transactions below were independently checked as **finalized**, with no transaction errors. They form one DBC-to-DAMM v2 lifecycle across **three separate runs**, with continuation after failures; they were not sent by one uninterrupted process. The final rehearsal checked receipts for earlier DBC trades before resuming, then reached the migration threshold, migrated, and performed a DAMM v2 buy.

- DBC pool: [4KSYjPvfeQghULdKBD7r1T2naxCvLtknr3QET3VcuaGS](https://solscan.io/account/4KSYjPvfeQghULdKBD7r1T2naxCvLtknr3QET3VcuaGS?cluster=devnet)
- DAMM v2 pool: [BWc9k9ggRS1d4KSU9DkokTU16nvYUCH9B7MgMKxVRr5j](https://solscan.io/account/BWc9k9ggRS1d4KSU9DkokTU16nvYUCH9B7MgMKxVRr5j?cluster=devnet)
- Test configuration: SPL base / WSOL quote, supply 1,000,000, 6 decimals, 1% DBC fee, 0.1 SOL migration threshold.
- After spending 0.001 devnet SOL on the DAMM v2 buy, the token balance increased by 1,960.551642 LCTEST (1,960,551,642 raw units).

| Lifecycle step | Finalized transaction | Slot |
|---|---|---:|
| Create DBC config | [Open on Solscan](https://solscan.io/tx/3GB8Y6HZ8uiSrMMP6xMmAiAGHi3BshaU1zskmuCRSzUwES7UCT43AXm8RkMBCkEaTcZ3WiJoPfXTUcwy8oJvB2eA?cluster=devnet) | 506971350 |
| Create DBC pool | [Open on Solscan](https://solscan.io/tx/3Ny4aFxiptvF9GoGHWQ4nSrd4esFE2GmFBsy64zDs1CJxq7Z8vLgmWazGKGxGZVNpmbSsHrLYFGdCdaFu6eba4gT?cluster=devnet) | 506971382 |
| DBC buy | [Open on Solscan](https://solscan.io/tx/3Ug3ogijf4yt5o5Majw7jkYhAgrzCnYswCZCajjGLtegqY4xsey69PcH9nbsFrzUaRdSV47eBEdjRropceYPACMJ?cluster=devnet) | 507009281 |
| DBC sell | [Open on Solscan](https://solscan.io/tx/3324WQnidBZ6SX18YACPz8Mxv9ZWSLr4PY861VTmEsx36d1gxfAyK9o7FZkJKRES4kgKFZRiGE6YD6anNdc3GToT?cluster=devnet) | 507009312 |
| Reach migration threshold | [Open on Solscan](https://solscan.io/tx/3aiUrdNusEzFxJ6DuymZfxLN13YkqBn7UTPxG3d45ugfYjVnsDvga6Pav3BZuPxjMRtnQfuuWkXvkHBkS1fN7JU4?cluster=devnet) | 507010916 |
| Migrate to DAMM v2 | [Open on Solscan](https://solscan.io/tx/4HgFs4BRs4q1sMrRgo9F4oECpbsQoaa3YkCwMmLsSq6N5ahcJrvqgTDAcM2UQKezcyt2gwd1vUL8CR2Bg9Mtr6oH?cluster=devnet) | 507010948 |
| DAMM v2 buy | [Open on Solscan](https://solscan.io/tx/4gem5jewxCNDsEFEA6p3o2VhqiUj9cBwnrwb3K4V7dRe6WUo382hXWHra9wew8vqV8ws7vph5u2YVQoKVW643VF7?cluster=devnet) | 507010989 |

## Snapshot comparison

The rehearsal saved a live Devnet inspection before continuing, followed by one after migration. The application can import the before snapshot and compare it with a fresh live read of the same pool and cluster:

- Before threshold completion: [devnet-before.json](../examples/devnet-before.json) (`source: live`, stage `trading`).
- After migration: [devnet-after.json](../examples/devnet-after.json) (`source: live`, stage `migrated`, DAMM pool verified).

The saved reports are unsigned user-provided baselines. They are convenient records for the app's comparison flow; Solscan transaction links above are the public transaction references. The comparison shows four state changes: quote reserve, lifecycle stage, DAMM pool address, and migration verification. Pool configuration did not change.

## Scope and limits

This is a Devnet rehearsal, not a Mainnet launch or production reliability claim. Mainnet was used for read-only inspection of two existing pools. The UI does not establish actual ownership of LP position NFTs, position locks, or vesting; a verified DAMM pool account does not prove it is currently trading. The seven transactions span three runs, and earlier failed/interrupted attempts remain recorded separately from the successful finalized transactions. Current dependency audit findings and mitigation scope are documented in [SECURITY.md](../SECURITY.md).

See the [original project proof](../DEVNET-PROOF.md) for the Russian run notes and the [demo walkthrough](DEMO-SCRIPT.md) for the live inspection and comparison steps.
