# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` points here;
this file is the single source of truth.

## What this is

A static, client-side calculator that sizes hardware for self-hosted LLM inference:
given a model, a workload profile, a user count and an SLA, it ranks concrete
deployments (accelerator, GPU count, parallelism, interconnect, `$/1M tokens`, and
the `vllm serve` line) and reports every rejected candidate with a machine-checked
reason.

No backend, no telemetry, no persistence. It builds to static files and deploys to
GitHub Pages.

## Commands

```bash
npm ci
npm run dev                       # vite dev server
npm test                          # vitest run — the full suite
npm test -- src/core/memory.test.ts        # one file
npm test -- -t "MLA models need far less KV"   # one test by name
npm run test:watch
npm run typecheck                 # tsc -b --noEmit
npm run build                     # tsc -b && vite build
```

CI (`.github/workflows/deploy.yml`) runs test → typecheck → build on every push to
`main`, and a red suite blocks the Pages deploy. Run `npm test && npm run typecheck`
before claiming work is done.

## Architecture

Three layers, dependencies strictly one-way: `data → core → ui`.

**`src/data/`** — JSON catalogs plus Zod parsers. Every catalog is parsed at module
scope in `index.ts`, so a malformed file throws at *import* time — in tests, in the
build, everywhere — rather than surfacing bad numbers to a user. Adding a field means
touching both the JSON and its schema in `schema.ts`.

**`src/core/`** — the calculation, as pure TypeScript. No React, no DOM, no runtime
dependencies. `purity.test.ts` enforces this by scanning imports; it will fail the
build if a core file imports React or a stylesheet. Pipeline:

```
workload.ts    profile + DAU        → DerivedLoad (peak RPS, concurrency, token rates)
memory.ts      model + quant + TP   → weights, KV/token, what fits per GPU
parallelism.ts                      → candidate TP/PP/EP splits + interconnect check
throughput.ts  memory + coefficients→ decode/prefill capacity, TTFT, utilization
cost.ts        performance + prices → capex, power, $/1M tokens, TCO
launch.ts                           → the vllm/sglang command line
solver.ts                           → enumerates candidates, ranks, explains rejections
```

**`src/deploy/`** — the turnkey-deployment estimate (the *Deploy* tab), one layer up from
`core`. Same discipline: pure TypeScript, `purity.test.ts` covers it too, and it depends on
`core` (to re-run `solve()` for redundancy degradation checks) and `data` (for its own
`infra.json`/`chassis.json`/`software.json` catalogs) — never the other way. One entry point,
`estimate()` in `estimate.ts`, priced bottom-up and deliberately NOT netted against
`core/cost.ts`'s numbers (see that file's header for why). Sub-modules: `availability.ts`
(redundancy, spares, degradation), `hardware.ts`/`facility.ts`/`ops.ts`/`software.ts` (cost
categories), `waterfall.ts`/`breakeven.ts`/`risks.ts` (presentation-shaped output).

**`src/ui/`** — React. `state.ts` mirrors all form state into the query string;
`panels/` are inputs, `results/` are outputs, `i18n/` is the dictionary pair.

### Rules that are easy to break

**One solver, two modes.** `solve()` in `solver.ts` is the only entry point. Explore
enumerates `accelerator × quant × parallelism`; Verify passes a `SolvePin` and
evaluates only how that fixed fleet can be split. Both run identical evaluation and
ranking code — that is *why* a pinned candidate always agrees with the explore
candidate describing the same hardware. Do not add a second evaluation path.

**Rejections are product, not error handling.** `SolveResult.rejections` carries a
typed `RejectionReason` plus a human-readable detail and the size of the miss.
Explaining why the cheaper option is impossible is half the value of the tool. Never
silently drop a candidate.

**Branded units.** `units.ts` brands `Bytes`, `Seconds`, `TokensPerSec`, `Usd`,
`Watts`. Construct through the helpers (`gib()`, `usd()`, `tokensPerSec()`), don't
cast raw numbers — the brands are the only thing stopping a GiB/GB or seconds/ms mixup.

**Money is optional by construction.** Every money field is `Usd | null` and must be
`null`, never `NaN`, when a price is missing or the arithmetic is degenerate. Many
accelerators (Chinese parts especially) have no publishable price. In `costMode: 'off'`
all money goes `null` while `powerWatts` stays real — the calculator must keep working
when the price file goes stale.

**In `src/deploy/`, `null` means "unpriced," never "not applicable."** `MoneyRange` (`{low,
high} | null`) uses the same discipline, and `sumM`/`addM` (`range.ts`) propagate `null`
through every total that touches it — by design, so a missing price doesn't silently become
a bogus zero. That means a component that structurally doesn't apply (electricity bundled
into the colocation fee, hardware has no monthly line) must be represented as `ZERO`
(`{low: 0, high: 0}`), never `null` — passing `null` for "not applicable" poisons every other,
perfectly-priced figure it's summed with. This broke `fullUsdPerMillionTokens` for a
fully-priced accelerator during development (`estimate.ts`'s `toHourly` calls were passing a
literal `null` for "this component has no monthly/one-time half," not "unknown") and was only
caught by actually running the app — the unit tests had guarded the check inside an
`if (value)` and passed vacuously. If you touch `hardware.ts`, `facility.ts`, `ops.ts` or
`estimate.ts`, keep this distinction, and don't write a test that skips its own assertion
when the value under test is `null`.

**Two token prices, deliberately.** `usdPerMillionTokens` is blended (prompt +
output); `usdPerMillionOutputTokens` is the API-comparable one. On a prompt-heavy
profile they differ by ~15×. Do not collapse them into one number.

**Uncertainty is stated, not hidden.** `UNCERTAINTY = 0.25` in `types.ts` and
`range()` in `throughput.ts`: every throughput-derived figure is shown as a ±25% band,
never a point value. `SLA_TOLERANCE = 0.2` in `solver.ts` is the related rule — a
candidate missing the SLA by up to 20% stays in the list with a `Warning`, beyond that
it is rejected. Hiding a candidate that missed by 10% would be false precision against
a model that is itself ±25%.

**The URL is the state.** `encodeState` omits every field still at its default (so a
fresh page has a bare URL), and `decodeState` never throws — a stale or hand-edited
link degrades field by field instead of blanking the page. Any new input must go
through `state.ts`, and ids are validated against the live catalogs so retiring a model
automatically invalidates links naming it.

**i18n is compiler-enforced.** `en.ts` defines the shape; `ru.ts` is typed as `Dict`,
so a missing or misspelled key is a type error. Every new user-facing string needs both
languages in the same commit.

## Data provenance

This is the project's main discipline — do not weaken it.

- Models carry `sourceUrl` (the upstream `config.json` the hyperparameters were read
  from) and `verifiedAt`. Layer counts, KV heads, MLA ranks and expert counts come from
  upstream, never from recollection.
- **Licenses are per repository, never per family, and never inferred from a name.**
  `license` is a label; `licenseCommercialCondition` is what the LICENSE file actually
  says, with the severity it actually carries (`warning` = a duty rides along,
  `blocking` = commercial use needs the licensor's permission). Read every repo's own
  LICENSE and cite it in `licenseSourceUrl`.

  This has bitten twice in one direction and once in the other. A family-wide
  assignment plus a `/non-commercial|restricted|custom/i` regex over the label flagged
  all 8 GLM models — plain MIT — as commercially restricted, while silently missing
  MiniMax **M2.7** (`NON-COMMERCIAL LICENSE`: commercial use prohibited without written
  authorization), MiniMax **M3** (grant is non-commercial only) and Kimi **K3** (a
  Model-as-a-Service business over $20M/12mo needs a separate agreement with Moonshot).
  Both families are genuinely mixed upstream: MiniMax spans Apache-2.0, plain MIT,
  modified MIT and two non-commercial licenses; Kimi K3 is not the K2 Modified MIT.
  `catalogs.test.ts` now fails if either family collapses to a single label.

  When re-verifying, grep the license text broadly — an earlier sweep missed MiniMax
  M2's clause because the pattern covered "monthly/yearly revenue" but the file says
  "annual recurring revenue". The HF API `cardData.license` tag is a starting point,
  not an answer: `other` tells you nothing, and a `modified-mit` tag has pointed at a
  file with no modification at all.
- Accelerator figures come from vendor datasheets. Anything vendor-claimed and not
  independently verified must carry a `note`, which the UI surfaces.
- Efficiency coefficients (MBU/MFU) live in `coefficients.json` as data per hardware
  family, not as constants in code. Chinese parts carry lower values, reflecting kernel
  maturity.
- Prices are isolated in `pricing.json` behind a single `pricesAsOf`. They are the
  first thing to go stale, so nothing else may depend on them.

## Testing

Unit tests sit next to their module. Two suites are structural rather than per-function:

- `core/reality.test.ts` — order-of-magnitude guards against known public deployments
  (e.g. aggregate decode on an 8× H200 node against DeepSeek's published per-node
  figure). Tolerances are wide on purpose; these catch modelling errors, not drift.
- `core/purity.test.ts` — enforces the layering rule above.

**Known modelling gap:** decode throughput at low batch is optimistic, because MBU is a
batch-independent constant with no per-step latency floor. Single-stream figures are an
upper bound. The full note is at the bottom of `core/reality.test.ts`; the fix belongs
in `throughput.ts`.

## Conventions

Module headers explain *why* the code is shaped the way it is and cite the spec section
they implement (`docs/superpowers/specs/`). Match that: comments here carry reasoning
and rejected alternatives, not restatements of the code. Formulas that were subtly
wrong once are documented with what went wrong — keep those.
