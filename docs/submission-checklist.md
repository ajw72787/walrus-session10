# Tatum x Walrus Total Recall submission checklist

Deadline: **November 10, 2026, 17:00 UTC**.

## Required evidence

- [ ] At least 10 meaningful Walrus Mainnet memories. Current audited namespace
  inventory: 6 distinct active memories; 3 are index-linked forecasts and 0
  are index-linked evaluations. Do not create artificial memories just to meet
  this count.
- [x] Public GitHub repository: <https://github.com/ajw72787/walrus-session10>
- [x] Working public demo: <https://suix5-intelligence.vercel.app/>
- [ ] Published blog article explaining the problem, architecture, Mainnet
  memory persistence, and learning-loop status.
- [ ] A 2–3 minute demo video. Use [demo-script.md](demo-script.md) and show
  only implemented behavior.

## Submission identifiers — fill from authorized project records

Do not commit private keys, seed phrases, delegate secrets, or `.env` values.

| Item | Value to provide before submission |
| --- | --- |
| Tatum ID | `<retrieve from authorized Tatum project/account record>` |
| SUI address | `<public SUI address>` |
| SUI Account ID | `<public MemWal/Sui account object ID>` |
| `MEMWAL_AGENT_ID` | `<public agent identifier, if assigned>` |
| Walrus namespace | `suix5-market-intelligence-walrus-session10` |
| Public dashboard | `https://suix5-intelligence.vercel.app/` |
| Public repository | `https://github.com/ajw72787/walrus-session10` |

## Narrative prompts

- [ ] Explain the experience using Walrus: durable structured Mainnet forecast
  and evaluation records, metadata inventory, semantic-recall limitation, and
  public memory/blob evidence IDs.
- [ ] Explain the experience using Tatum AI Builder: native authenticated Sui
  gRPC reads of the Registry/StateV2 source and active target allocations.
- [ ] State that the model predicts a normalized virtual proxy, not actual
  SUIX5 vault NAV or a tradeable token price.
- [ ] State the audited learning-loop truth: evaluation support is implemented,
  but 0 completed evaluations currently means calibration has not yet been
  demonstrated.

## Before submitting

- [ ] Re-run the Mainnet metadata inventory and record the count/date.
- [ ] Confirm at least 10 *meaningful* forecast/evaluation memories, not setup
  probes or duplicate records.
- [ ] Confirm evaluated outcomes appear in the public snapshot/dashboard.
- [ ] Check that the public dashboard has a recent snapshot timestamp and
  working Walrus evidence identifiers.
- [ ] Verify the repository is public and the dashboard URL is accessible in a
  signed-out browser.
- [ ] Review the video, article, and every identifier for accuracy and absence
  of secrets.
