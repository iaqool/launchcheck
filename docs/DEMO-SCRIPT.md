# LaunchCheck demo script (target: 2–3 minutes)

## Before recording

1. Run `npm run build`, then `npm start`; open `http://127.0.0.1:4174`.
2. Keep the app on its default **Mainnet** selection. This demo uses **Devnet** explicitly.
3. Have this saved baseline file ready to import: `examples/devnet-before.json`.
4. No wallet is needed for the app demonstration. The inspection shown in the UI performs network reads only.

## Timed walkthrough

### 0:00–0:20 — Frame the product

**Say:** “LaunchCheck is a read-only developer tool for inspecting Meteora DBC pools and their migration state into DAMM v2. It does not connect a wallet, sign, or send transactions. Today I’ll inspect a real Devnet pool and compare its current state with a saved earlier snapshot.”

**Show:** The LaunchCheck landing screen and its DBC trading → curve complete → DAMM v2 lifecycle. Point out the **READ ONLY** label.

### 0:20–0:55 — Read the migrated Devnet pool

**Do:** In **Network**, select **Devnet**. In **DBC pool address**, enter `4KSYjPvfeQghULdKBD7r1T2naxCvLtknr3QET3VcuaGS`. Click **Inspect pool** and wait for the result.

**Say:** “This address is the Devnet pool used in the documented lifecycle rehearsal. The badge says LIVE READ, so these values come from the selected network now; this is not one of the illustrative samples.”

**Show:** **LIVE READ**, `devnet`, **Migrated**, migration verification, and the DAMM pool address `BWc9k9ggRS1d4KSU9DkokTU16nvYUCH9B7MgMKxVRr5j`. Briefly point to reserves, fee/config facts, and checks without describing them as a safety verdict.

### 0:55–1:35 — Compare to a saved baseline

**Do:** Click **Import baseline**, choose `examples/devnet-before.json`, then click **Compare reports**.

**Say:** “The baseline is a locally saved report from the same pool and Devnet before threshold completion. LaunchCheck compares it with the current live read and separates configuration from state changes. Imported JSON is a user-provided, unsigned baseline, not independent proof.”

**Show:** The comparison changes for reserve, stage, DAMM address, and migration verification. This baseline is itself a saved live Devnet read (`source: live`), not a demo fixture; the current passport is a fresh live network read. The JSON is user-provided and unsigned, so it is a comparison reference rather than authenticated evidence.

### 1:35–2:10 — Ground claims in evidence

**Say:** “The lifecycle was exercised in a separate Devnet rehearsal: seven transactions reached finalized status across three runs, including DBC buy and sell, threshold, migration, and a DAMM v2 buy. The original evidence document links each transaction. Two existing Mainnet pools have also been checked read-only. This is developer tooling, not a new launchpad or a security certification.”

**Show:** Optionally open the English [Devnet evidence and transaction links](DEVNET-PROOF.en.md). Keep the local app as the main view.

### 2:10–2:25 — Close

**Say:** “The report shows configured LP allocation, but actual position NFT ownership and locks remain unknown. You can save this report and compare it with a later read to see what changed after migration.”

**Show:** End on the migrated passport and its comparison panel. Keep the unknown LP ownership and lock checks visible if they are on screen.

