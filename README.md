# SUIX5 Intelligence

Read-only market intelligence for the existing SUIX5 index, built for the
**Markets & Sports Prediction** track of the Tatum x Walrus Total Recall
hackathon. It creates timestamped 4-hour, 12-hour, and 24-hour directional
forecasts, persists the evidence in Walrus Memory, and publishes a sanitized
public snapshot for the dashboard.

- Public dashboard: <https://suix5-intelligence.vercel.app/>
- Source repository: <https://github.com/ajw72787/walrus-session10>
- Explore SuiX: <https://sui-x.com>

This application is research-only. It does not sign transactions, control a
wallet, trade, or modify the SUIX5 vault, keeper, tracker, or contracts.

## Architecture

```text
ZBook (private)                         Public internet
────────────────────────────────────    ───────────────────────────────────
PM2 UTC scheduler → prediction worker   GitHub → Vercel dashboard
       │             │                         │
       │             ├─ Tatum native Sui gRPC  └─ public/data/predictions.json
       │             ├─ CoinGecko hourly USD
       │             ├─ Walrus Memory Mainnet
       │             └─ local ignored operational index
       └─ optional isolated Git publisher ─────→ sanitized snapshot only
```

The private worker is the only component with Tatum and MemWal credentials.
Vercel reads only the committed public JSON snapshot. There is no dashboard
server route that can read the local index, call a provider, generate a
forecast, or write a Walrus memory.

## SUIX5 basket and on-chain source

Every worker run reads the active SUIX5 `StateV2` generation through Tatum's
native Sui gRPC client rather than hardcoding allocations. The currently
verified generation is `2`, with target allocations:

| Asset | Target weight |
| --- | ---: |
| SUI | 40.00% |
| WAL | 30.49% |
| DEEP | 16.96% |
| CETUS | 9.30% |
| NAVX | 3.25% |

The public dashboard republishes those verified target weights when a fresh
on-chain read is available. It does not use on-chain NAV while `nav_valid` is
false.

## Forecast, maturity, and scoring method

`weighted-momentum-v1` obtains seven days of hourly USD data from CoinGecko
for the five active constituents. It rejects a run when an asset lacks at least
49 points, the latest point is more than two hours stale, or a required
historical point has a gap over two hours.

For each horizon (4h, 12h, and 24h), the method:

1. Builds a normalized $100 virtual basket from the current on-chain weights
   and observed constituent prices.
2. Computes target-weighted log momentum over the horizon and target-weighted
   24-hour hourly-return volatility.
3. Divides momentum by a volatility floor to obtain a score. Scores over 0.15
   predict up, below -0.15 predict down, and the rest predict flat.
4. Stores the exact baseline constituent prices, target weights, method version,
   issue timestamp, and maturity time in the private operational index and in
   the immutable Walrus forecast record.
5. On a later successful worker run, prices the same virtual quantities at
   maturity, determines the actual proxy direction, and writes a linked Walrus
   evaluation record.

This is a **normalized $100 virtual index proxy**. It is not the actual SUIX5
redeemable vault NAV, a vault accounting value, or a SUIX5 token market price.

## Calibration and learning status

Each forecast carries bounded score-derived confidence and is explicitly
labelled **uncalibrated**. Pooled cross-horizon calibration is disabled.

New forecasts also record a Walrus-evidenced, horizon-specific historical
reliability snapshot. It includes only completed same-horizon evaluations whose
forecast and evaluation records both have Walrus evidence and were available at
issue time. The snapshot uses Beta(1,1) smoothing and remains **shadow-only**:
it does not alter direction or confidence. The current counts and outcomes are
published in the public snapshot rather than hardcoded here.

## Walrus Mainnet evidence

The server-side MemWal SDK uses the production relayer and the namespace
`suix5-market-intelligence-walrus-session10`. Forecasts and evaluations are
written as structured immutable records. The ignored local index records each
Walrus memory/blob ID, and the public snapshot exposes those identifiers as
persistence evidence without exposing raw private inputs.

The public snapshot and operational index show the current linked forecast and
evaluation evidence. Do not substitute setup records for meaningful prediction
or evaluation outcomes when assessing submission evidence. See
[submission checklist](docs/submission-checklist.md).

MemWal `listMemories()` is deterministic metadata inventory; `recall()` is
semantic and cannot guarantee exact recovery of every record. Loss of the
ignored operational index therefore prevents deterministic reconstruction of
the forecast ledger from semantic recall alone.

## Scheduling and sanitized publishing

One PM2 fork scheduler runs at 00:00, 04:00, 08:00, 12:00, 16:00, and 20:00
UTC. The worker lock, deterministic forecast IDs, and publisher lock prevent
overlap or duplicate writes.

After a successful non-dry worker cycle, the worker generates
`public/data/predictions.json`. The optional publisher uses a detached Git
worktree based on `origin/main`, stages only that JSON file, ignores a
timestamp-only change, and does not pull, rebase, reset, or force-push.
Publishing failure is caught after prediction/evaluation writes and cannot roll
back or interrupt their persistence.

The running ZBook scheduler has automatic sanitized snapshot publishing
enabled. It does not publish source files or private operational data.

## Local setup

Install dependencies and create an ignored `.env.local` with server-side
values only:

```text
TATUM_API_KEY=<redacted>
MEMWAL_PRIVATE_KEY=<redacted>
MEMWAL_ACCOUNT_ID=<redacted>
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz
```

Useful commands:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run worker:dry
npm run snapshot:generate
npm run snapshot:publish:dry
npm run dev
```

Never commit `.env*`, `.memwal/`, `data/prediction-index.json`, lock files, or
credential files. Do not use the PM2 start/stop commands on an already running
production scheduler without an operational review.

## Known limitations

- Horizon-specific reliability is descriptive, not calibrated: overlapping
  forecast horizons are correlated and the shadow analysis does not alter model
  confidence or direction.
- CoinGecko public price data can be rate-limited or stale; an invalid/stale
  input skips the prediction rather than inventing one.
- The virtual-basket proxy is deliberately not represented as actual SUIX5 NAV
  or trading price.
- The dashboard displays a GitHub-published snapshot and can be stale until a
  later successful worker cycle publishes a material update.
