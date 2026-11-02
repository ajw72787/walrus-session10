# 2–3 minute SUIX5 Intelligence demo script

Use the live dashboard and repository. Do not claim features that are not
visible or supported by the current data.

## 0:00–0:20 — Problem and scope

“SUIX5 Intelligence is a read-only market prediction agent for the existing
SUIX5 five-asset basket. It does not control the vault, sign a transaction, or
place trades. The goal is to create persistent, inspectable directional
forecasts rather than present a trading interface.”

Show the dashboard header and the Explore SuiX link.

## 0:20–0:50 — Live SUIX5 context

Show the current allocation section. Explain that the worker reads the active
SUIX5 StateV2 generation through Tatum native Sui gRPC each run. Name the five
constituents—SUI, WAL, DEEP, CETUS, and NAVX—and explain that the displayed
weights are target allocations from the published verified snapshot.

“These weights are not hardcoded into the forecast.”

## 0:50–1:25 — Forecast methodology

Show the 4h, 12h, and 24h cards and their issue/maturity times.

“For each horizon, the worker uses CoinGecko hourly prices to construct a
normalized $100 virtual basket. It combines target-weighted log momentum and
24-hour volatility, then produces up, down, or flat. This is a proxy—not
actual redeemable SUIX5 NAV or a token market price.”

Point out the `uncalibrated` confidence label.

## 1:25–1:55 — Walrus persistence

Show the forecast ledger and the Walrus memory/blob identifiers.

“Each forecast is stored as a structured immutable Walrus Mainnet memory. The
public dashboard shows the persistence identifiers, while the private worker
keeps exact evaluation inputs in its local operational index.”

If there are evaluated records at recording time, show actual direction and
correctness. If not, say: “The evaluation workflow is implemented, but these
records are still pending; I will not claim accuracy before maturity.”

## 1:55–2:25 — Automation and publication boundary

Show the repository’s architecture or README.

“One PM2 worker runs every four hours in UTC. After a successful cycle it
creates a sanitized snapshot. An isolated Git worktree publisher can commit
only that snapshot, and Vercel renders it without provider or MemWal
credentials.”

## 2:25–2:45 — Honest status and close

“The current limitation is sample size: forecast evaluation and confidence
calibration require enough mature outcomes. The project makes that visible by
labelling confidence uncalibrated until 12 evaluations, and it does not
fabricate prices, outcomes, or performance.”

End on the public dashboard URL and repository URL.
