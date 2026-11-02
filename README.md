# SUIX5 Market Intelligence Agent

## Read-only Sui discovery

The discovery utilities use Tatum Sui Mainnet native gRPC through the modern
`SuiGrpcClient`. They require `TATUM_API_KEY` in the ignored `.env.local` file
and make no signing or transaction-execution calls.

```bash
npm run test:tatum-sui
npm run discover:suix5
npm run discover:suix5:active
npm run discover:suix5:table -- <dynamic-field-parent-id>
npm run discover:suix5:transactions -- <package-or-module-filter>
```

`discover:suix5:events` is retained for providers that expose `ListEvents`; the
current Tatum gateway rejects that RPC, so use the transaction-history mode and
request included events instead.

## Walrus Memory server adapter

`lib/memwal.ts` is a server-only adapter around the official MemWal TypeScript
SDK. It requires these server-side environment variables (for example, in the
ignored `.env.local` file or a deployment secret store):

```text
MEMWAL_PRIVATE_KEY=<Ed25519 delegate private key>
MEMWAL_ACCOUNT_ID=<MemWalAccount object ID>
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz
```

The adapter defaults to the production relayer and the
`suix5-market-intelligence-walrus-session10` namespace. It does not use Codex
MCP authentication. Verify an independently configured SDK client with:

```bash
npm run test:memwal
```

The test performs health, waits for an authenticated durable write, and recalls
the exact labeled record. Health alone does not validate the delegate key.
`.env*` and `.memwal/` are excluded from Git.

## Prediction worker

The read-only worker loads the active `StateV2` generation from the SUIX5
Registry through Tatum gRPC on every run; it does not hardcode index weights.
It obtains seven days of hourly USD history from CoinGecko's documented
`market_chart` endpoint for SUI (`sui`), WAL (`walrus-2`), DEEP (`deep`), CETUS
(`cetus-protocol`), and NAVX (`navi`). A run skips safely if any series has
fewer than 49 points, exceeds the two-hour freshness limit, or has a gap over
two hours at a required lookback.

The value is a $100 virtual-basket proxy, not redeemable SUIX5 NAV or a market
trading price. At forecast time it sets each virtual quantity to target weight
divided by its observed USD price; later values reprice those same quantities.
`weighted-momentum-v1` uses horizon-matched log momentum, 24-hour hourly-return
volatility, and a fixed direction threshold. Confidence remains uncalibrated
until at least 12 completed evaluations exist.

```bash
npm test
npm run worker:dry
npm run worker:run
```

`data/prediction-index.json` is an ignored local operational index. It uses
atomic rename writes and a single-worker lock, and records the exact forecast
inputs, maturity, Walrus IDs, and evaluation state. Walrus remains the immutable
evidence store, but loss of this local index prevents guaranteed recovery:
MemWal recall is semantic and is not guaranteed to retrieve every forecast.

### PM2 scheduler

PM2's `cron_restart` is not used: PM2 documents that it requires the managed
application to be running, while this project's forecast worker deliberately
exits after one run. Instead, PM2 keeps a single lightweight scheduler online.
The scheduler uses UTC, invokes the unchanged one-shot worker at 00:00, 04:00,
08:00, 12:00, 16:00, and 20:00 UTC, and logs its startup, next invocation,
worker start, and result. The worker's lock and deterministic forecast IDs
remain the overlap/duplicate safeguards. If PM2 or the host restarts, PM2
restarts the scheduler; it waits for the next UTC boundary rather than creating
an off-schedule forecast. A stale lock from an interrupted worker is recovered
only after its recorded PID is confirmed dead.

The production timer is disabled unless `ENABLE_PREDICTION_SCHEDULE=true` is
present when PM2 loads the ecosystem file. `pm2:start` replaces only the named
prediction process, which is necessary when migrating from the old one-shot
PM2 entry; it does not touch keeper, watchdog, or tracker processes. Start the
disabled scheduler, inspect it, and remove it with:

```bash
npm run pm2:start
npm run pm2:status
npm run pm2:logs
npm run pm2:stop
```

To enable the real four-hour schedule after review, run exactly:

```bash
ENABLE_PREDICTION_SCHEDULE=true npm run pm2:start
```

Use `npm run pm2:stop` to disable it immediately. For an isolated short-interval
dry-run test, do not use the production enable flag; launch PM2 with
`SUIX5_SCHEDULER_DRY_RUN=true SUIX5_SCHEDULER_TEST_INTERVAL_MS=2000 npm run pm2:start`,
inspect the logs, then run `npm run pm2:stop`. This test invokes the worker with
`--dry-run`, so it does not write Walrus memories or change the prediction index.

## Public snapshot and dashboard

`public/data/predictions.json` is the only data source for the public Next.js
dashboard. It is generated from an explicit field allowlist; it never contains
the raw index, constituent prices, credentials, operational paths, or logs.
It preserves public forecast/evaluation evidence IDs and target weights from a
fresh Tatum StateV2 read when available. It is a normalized $100 virtual-basket
proxy, never actual SUIX5 NAV or a trading price.

```bash
npm run snapshot:generate
npm run dev
npm run build
```

The worker refreshes this file after each successful non-dry cycle. Snapshot
failure is logged but cannot alter a completed forecast record. The dashboard
does not call Tatum, CoinGecko, or Walrus and receives no environment variables
or wallet capabilities.

### Safe GitHub snapshot publishing

Publishing is deliberately disabled. The publisher checks the existing remote,
fetches `origin/main`, and uses a temporary detached Git worktree. It stages and
commits exactly `public/data/predictions.json`; it never stages the dirty ZBook
development tree, pulls, rebases, resets, force-pushes, or publishes source
files. It ignores a changed `lastPublishedAt` value when deciding whether a
commit is necessary and retries a rejected/network push at most three times.

Review its behavior first:

```bash
npm run snapshot:generate
npm run snapshot:publish:dry
```

After review, enable the worker's optional publishing step and reload the PM2
scheduler environment with:

```bash
ENABLE_PREDICTION_SCHEDULE=true ENABLE_PUBLIC_SNAPSHOT_PUBLISH=true npm run pm2:start
```

This is the only command that enables automatic snapshot commits. To make a
single reviewed publish instead, run:

```bash
ENABLE_PUBLIC_SNAPSHOT_PUBLISH=true npm run snapshot:publish
```

### Vercel deployment

Do not place Tatum or MemWal credentials in Vercel: the deployed dashboard only
needs the tracked `public/data/predictions.json` file. Once the code and a first
snapshot are intentionally committed and pushed, import
`ajw72787/walrus-session10` in Vercel, use the repository root (`.`), accept
the auto-detected Next.js framework, and deploy. Vercel uses `npm run build` and
will assign the public URL shown in the project dashboard (for example, its
`*.vercel.app` URL); no URL is configured or deployed by this repository yet.

For Git-connected deployments, a published snapshot commit triggers Vercel's
normal Git deployment. Use the Vercel-assigned production URL as the public
dashboard URL only after reviewing that deployment.
