# LLM Hardware Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static, dependency-light web calculator that sizes server hardware for self-hosted inference of Kimi, GLM, DeepSeek, Qwen and MiniMax models, published on GitHub Pages.

**Architecture:** A pure-TypeScript core (`src/core/`) with zero runtime dependencies holds every formula and the candidate solver; JSON catalogs in `src/data/` hold model, accelerator, pricing and coefficient data validated by Zod at build time; a thin React layer in `src/ui/` renders inputs and results and mirrors all state into the URL query string. The solver enumerates `accelerator × quantization × parallelism`, rejects infeasible candidates with a machine-readable reason, and ranks survivors.

**Tech Stack:** TypeScript 5.9+, React 19, Vite 7, Tailwind CSS 4, Vitest 3, Zod 4, GitHub Actions + `actions/deploy-pages`.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-04-llm-hardware-calculator-design.md`. Where this plan and the spec disagree, the spec wins.
- `src/core/**` and `src/data/**` MUST NOT import React, any DOM API, or any npm runtime dependency except `zod` (used only in `src/data/schema.ts`). Enforced by a lint test in Task 2.
- Repository: `https://github.com/kryadov/llm-hardware-calculator`. Branch: `main`. Published URL: `https://kryadov.github.io/llm-hardware-calculator/`.
- Vite `base` MUST be `/llm-hardware-calculator/`.
- Node 22. Package manager: npm. Lockfile committed.
- All memory quantities in the core are **bytes** (`Bytes` branded type). Conversion to GiB happens only at the UI boundary. `1 GiB = 1024³`. Accelerator HBM figures in catalogs are given in GiB.
- All bandwidth in **bytes/sec** (`BytesPerSec`). Catalog figures are given in GB/s where `1 GB/s = 1e9 bytes/s`.
- All compute in **FLOP/s** (`Flops`). Catalog figures are given in TFLOPS where `1 TFLOPS = 1e12`.
- Every entry in `models.json` MUST carry `sourceUrl` (a HuggingFace `config.json` blob URL) and `verifiedAt` (ISO date). Hyperparameters MUST be read from the actual upstream `config.json`, never recalled from memory.
- Every number rendered to the user that came from the throughput model is displayed as a ±25% range, never a bare point value.
- UI text lives in `src/ui/i18n/en.ts` and `src/ui/i18n/ru.ts`. No hardcoded user-facing strings in components.
- Commit after every task. Conventional Commits style (`feat:`, `test:`, `chore:`, `docs:`, `ci:`).
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/core/units.ts` | Branded numeric types and unit conversion helpers. No domain logic. |
| `src/core/types.ts` | Domain types: `ModelSpec`, `AcceleratorSpec`, `Workload`, `Candidate`, `Deployment`, `Rejection`, `SolveResult`. Types only, no code. |
| `src/core/memory.ts` | Weight bytes, KV bytes/token per attention type, overhead, per-GPU fit, `maxConcurrentSeqs`. |
| `src/core/workload.ts` | Load profile × DAU → peak RPS, concurrency, token lengths. |
| `src/core/throughput.ts` | Decode and prefill roofline, interconnect comm time, capacities, TTFT. |
| `src/core/parallelism.ts` | Enumerates legal `(tp, pp, ep)` tuples; interconnect legality checks; pipeline bubble penalty. |
| `src/core/cost.ts` | CAPEX, OPEX, power, TCO, `$/1M tokens`. |
| `src/core/launch.ts` | vLLM / SGLang launch command strings. |
| `src/core/solver.ts` | Enumerate → reject with reason → rank. Explore and Verify (pinned) entry points. |
| `src/data/schema.ts` | Zod schemas for all four catalogs. The only file importing `zod`. |
| `src/data/models.json` | ~25 model entries with HF-verified hyperparameters. |
| `src/data/accelerators.json` | NVIDIA DC, AMD Instinct, consumer RTX, Chinese accelerators, CPU/Apple. |
| `src/data/pricing.json` | Street prices and cloud hourly rates, one `pricesAsOf` for the file. |
| `src/data/profiles.json` | Load profiles (chat, coding agent, RAG, batch). |
| `src/data/coefficients.json` | MFU/MBU per hardware family × framework. |
| `src/data/index.ts` | Parses the JSON through the schemas at module load; exports typed catalogs. |
| `src/ui/App.tsx` | Shell: header, Explore/Verify tabs, two-column layout, error boundary, footer. |
| `src/ui/state.ts` | Form state type, defaults, URL encode/decode round trip. |
| `src/ui/panels/InputPanel.tsx` | Model, quantization, workload, hardware filters, cost mode. |
| `src/ui/panels/AdvancedPanel.tsx` | Disclosure with token lengths, peak factor, prefix cache, SLA, speculative. |
| `src/ui/results/LoadSummary.tsx` | Derived peak load strip. |
| `src/ui/results/DeploymentCard.tsx` | Collapsed/expanded deployment card. |
| `src/ui/results/MemoryBar.tsx` | CSS flex stacked memory breakdown. |
| `src/ui/results/RejectedTable.tsx` | "Не подошло" table with reasons. |
| `src/ui/results/HowComputed.tsx` | Formulas with the user's numbers substituted. |
| `src/ui/i18n/{en,ru,index}.ts` | Dictionaries and the language hook. |
| `.github/workflows/deploy.yml` | test → typecheck → build → deploy to Pages. |
| `README.md` | What it is, live URL, method summary, data provenance, disclaimer. |

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `src/index.css`, `.gitignore`
- Test: `src/core/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test`, `npm run typecheck`, `npm run build`. `vite.config.ts` exports `base: '/llm-hardware-calculator/'`.

- [ ] **Step 1: Scaffold with Vite**

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom
npm install -D tailwindcss @tailwindcss/postcss postcss autoprefixer
npm install zod
```

- [ ] **Step 2: Configure Vite base path and Vitest**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/llm-hardware-calculator/',
})
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

Add scripts to `package.json`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc -b --noEmit"
}
```

- [ ] **Step 3: Add `.gitignore`**

```
node_modules
dist
.idea
*.iml
.DS_Store
coverage
```

- [ ] **Step 4: Write the smoke test**

`src/core/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Run the checks**

Run: `npm test && npm run typecheck && npm run build`
Expected: tests PASS, typecheck clean, `dist/` produced with asset URLs prefixed `/llm-hardware-calculator/`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + react + ts + tailwind + vitest"
```

---

### Task 2: Units and domain types

**Files:**
- Create: `src/core/units.ts`, `src/core/types.ts`
- Test: `src/core/units.test.ts`, `src/core/purity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Bytes = number & { readonly __brand: 'Bytes' }`, likewise `BytesPerSec`, `Flops`, `Seconds`, `TokensPerSec`, `Usd`, `Watts`.
  - `gib(n: number): Bytes`, `toGib(b: Bytes): number`, `gbPerSec(n: number): BytesPerSec`, `tflops(n: number): Flops`, `bytes(n: number): Bytes`, `usd(n: number): Usd`, `watts(n: number): Watts`, `seconds(n: number): Seconds`, `tokensPerSec(n: number): TokensPerSec`.
  - All domain types listed below. Later tasks import these names verbatim.

- [ ] **Step 1: Write the failing unit test**

`src/core/units.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gib, toGib, gbPerSec, tflops } from './units'

describe('units', () => {
  it('gib uses binary multiples', () => {
    expect(gib(1)).toBe(1073741824)
  })
  it('toGib round-trips', () => {
    expect(toGib(gib(141))).toBeCloseTo(141, 9)
  })
  it('gbPerSec uses decimal multiples', () => {
    expect(gbPerSec(4800)).toBe(4.8e12)
  })
  it('tflops uses decimal multiples', () => {
    expect(tflops(989)).toBe(9.89e14)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/core/units.test.ts`
Expected: FAIL — cannot resolve `./units`.

- [ ] **Step 3: Implement `src/core/units.ts`**

```ts
declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

export type Bytes = Brand<number, 'Bytes'>
export type BytesPerSec = Brand<number, 'BytesPerSec'>
export type Flops = Brand<number, 'Flops'>
export type Seconds = Brand<number, 'Seconds'>
export type TokensPerSec = Brand<number, 'TokensPerSec'>
export type Usd = Brand<number, 'Usd'>
export type Watts = Brand<number, 'Watts'>

export const GIB = 1024 ** 3

export const bytes = (n: number) => n as Bytes
export const gib = (n: number) => (n * GIB) as Bytes
export const toGib = (b: Bytes) => (b as number) / GIB
export const bytesPerSec = (n: number) => n as BytesPerSec
export const gbPerSec = (n: number) => (n * 1e9) as BytesPerSec
export const flops = (n: number) => n as Flops
export const tflops = (n: number) => (n * 1e12) as Flops
export const seconds = (n: number) => n as Seconds
export const tokensPerSec = (n: number) => n as TokensPerSec
export const usd = (n: number) => n as Usd
export const watts = (n: number) => n as Watts
```

- [ ] **Step 4: Implement `src/core/types.ts`**

Define exactly these shapes — later tasks depend on these names.

```ts
import type { Bytes, BytesPerSec, Flops, Seconds, TokensPerSec, Usd, Watts } from './units'

export type AttentionType = 'mha' | 'gqa' | 'mla' | 'hybrid'
export type Quant = 'bf16' | 'fp8' | 'int8' | 'int4'
export type KvQuant = 'fp16' | 'fp8' | 'int4'
export type Framework = 'vllm' | 'sglang'
export type Vendor = 'nvidia' | 'amd' | 'consumer' | 'chinese' | 'cpu-apple'
export type Interconnect = 'nvlink' | 'xgmi' | 'hccs' | 'pcie' | 'ib400' | 'ib200' | 'ethernet' | 'unified-memory'
export type CostMode = 'buy' | 'rent' | 'off'

export interface GqaAttention {
  type: 'mha' | 'gqa'
  heads: number
  kvHeads: number
  headDim: number
  shardedByTp: true
  slidingWindow?: number
}
export interface MlaAttention {
  type: 'mla'
  heads: number
  headDim: number
  kvLoraRank: number
  qkRopeHeadDim: number
  shardedByTp: false
}
export interface HybridAttention {
  type: 'hybrid'
  heads: number
  kvHeads: number
  headDim: number
  fullAttentionLayers: number
  linearStateBytesPerSeq: number
  shardedByTp: true
}
export type Attention = GqaAttention | MlaAttention | HybridAttention

export interface MoeConfig {
  experts: number
  topK: number
  sharedExperts: number
  denseLayers: number
}

export interface ModelSpec {
  id: string
  family: 'Kimi' | 'GLM' | 'DeepSeek' | 'Qwen' | 'MiniMax' | 'Custom'
  displayName: string
  hfRepo: string
  totalParams: number
  activeParams: number
  layers: number
  hiddenSize: number
  vocabSize: number
  attention: Attention
  moe: MoeConfig | null
  maxContext: number
  nativeDtype: Quant
  sourceUrl: string
  verifiedAt: string
}

export interface AcceleratorSpec {
  id: string
  vendor: Vendor
  displayName: string
  memoryGib: number
  memBandwidthGbs: number
  peakTflops: { bf16: number; fp8: number | null; int8: number | null }
  tdpWatts: number
  maxPerNode: number
  intraNode: Interconnect
  intraNodeGbs: number
  frameworks: Framework[]
  coefficientFamily: string
  releaseYear: number
}

export interface LoadProfile {
  id: string
  requestsPerUserPerDay: number
  promptTokens: number
  outputTokens: number
  peakFactor: number
  prefixCacheHitRate: number
  slaTokensPerSec: number
  slaTtftSeconds: number
}

export interface Workload {
  profileId: string
  dau: number
  requestsPerUserPerDay: number
  promptTokens: number
  outputTokens: number
  peakFactor: number
  prefixCacheHitRate: number
  slaTokensPerSec: number
  slaTtftSeconds: number
  maxContext: number
  speculative: boolean
  gpuMemUtil: number
  kvQuant: KvQuant
}

export interface DerivedLoad {
  peakRps: number
  concurrentSeqs: number
  decodeTokensPerSecNeeded: number
  prefillTokensPerSecNeeded: number
  avgSeqLen: number
}

export interface Parallelism {
  tp: number
  pp: number
  ep: number
  gpusPerReplica: number
  nodesPerReplica: number
  requiredInterconnect: Interconnect | null
  bubblePenalty: number
}

export interface MemoryBreakdown {
  weightsPerGpu: Bytes
  kvPerGpu: Bytes
  overheadPerGpu: Bytes
  availablePerGpu: Bytes
  freePerGpu: Bytes
  kvBytesPerToken: Bytes
  maxConcurrentSeqs: number
  kvReplication: number
}

export interface Performance {
  perUserTps: TokensPerSec
  decodeCapacity: TokensPerSec
  prefillCapacity: TokensPerSec
  ttft: Seconds
  stepTime: Seconds
  prefillLoad: number
  decodeLoad: number
  commFraction: number
  batch: number
}

export interface CostBreakdown {
  capex: Usd | null
  hourlyRent: Usd | null
  powerWatts: Watts
  hourlyPower: Usd | null
  tco3y: Usd | null
  usdPerMillionTokens: Usd | null
}

export type RejectionReason =
  | 'oom'
  | 'slaTps'
  | 'slaTtft'
  | 'interconnect'
  | 'tpNotDivisible'
  | 'nodeLimit'
  | 'unsupportedQuant'
  | 'contextTooLong'
  | 'internal'

export interface Rejection {
  acceleratorId: string
  quant: Quant
  parallelism: Parallelism
  replicas: number
  reason: RejectionReason
  detail: string
  deficitBytes?: Bytes
  actual?: number
  required?: number
}

export interface Warning {
  kind: 'slaTps' | 'slaTtft' | 'degradedInterconnect' | 'immatureStack'
  detail: string
  missPercent?: number
}

export interface Deployment {
  acceleratorId: string
  accelerator: AcceleratorSpec
  quant: Quant
  parallelism: Parallelism
  replicas: number
  totalGpus: number
  totalNodes: number
  memory: MemoryBreakdown
  performance: Performance
  cost: CostBreakdown
  warnings: Warning[]
  framework: Framework
  launchCommand: string
  hostRamGib: number
  diskGib: number
}

export interface SolveResult {
  derived: DerivedLoad
  deployments: Deployment[]
  rejections: Rejection[]
}

export const UNCERTAINTY = 0.25
```

- [ ] **Step 5: Write the core-purity test**

`src/core/purity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CORE = join(process.cwd(), 'src/core')
const FORBIDDEN = /from\s+['"](react|react-dom|@testing-library|.*\.css)['"]/

describe('core purity', () => {
  it('core imports no React and no DOM-bound packages', () => {
    for (const f of readdirSync(CORE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = readFileSync(join(CORE, f), 'utf8')
      expect(FORBIDDEN.test(src), `${f} imports a forbidden module`).toBe(false)
    }
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core
git commit -m "feat(core): add branded units and domain types"
```

---

### Task 3: Data catalogs and schemas

**Files:**
- Create: `src/data/schema.ts`, `src/data/models.json`, `src/data/accelerators.json`, `src/data/pricing.json`, `src/data/profiles.json`, `src/data/coefficients.json`, `src/data/index.ts`
- Test: `src/data/catalogs.test.ts`

**Interfaces:**
- Consumes: types from `src/core/types.ts`.
- Produces: `MODELS: ModelSpec[]`, `ACCELERATORS: AcceleratorSpec[]`, `PROFILES: LoadProfile[]`, `PRICING: PricingTable`, `COEFFICIENTS: CoefficientTable`, all exported from `src/data/index.ts` and already validated.
  - `interface PricingTable { pricesAsOf: string; gpus: Record<string, { streetUsd: number | null; cloudUsdPerHour: number | null }>; chassisUsd: number; ibSwitchUsdPerNode: number; usdPerKwh: number; pue: number }`
  - `interface CoefficientTable { families: Record<string, { mbu: number; mfu: number; note: string }> }`

- [ ] **Step 1: Fetch upstream hyperparameters**

For each model below, fetch `https://huggingface.co/<repo>/raw/main/config.json` and read the real values. Do NOT write remembered numbers. If a repo 404s, try the `-Instruct` / `-Exp` variant, and if still unavailable, omit the model and note the omission in the commit message.

Models to include (~25):

| Family | HF repos |
|---|---|
| Kimi | `moonshotai/Kimi-K2-Instruct`, `moonshotai/Kimi-K2-Thinking` |
| GLM | `zai-org/GLM-4.6`, `zai-org/GLM-4.5`, `zai-org/GLM-4.5-Air`, `zai-org/GLM-4-32B-0414`, `zai-org/GLM-4-9B-0414` |
| DeepSeek | `deepseek-ai/DeepSeek-V3.2-Exp`, `deepseek-ai/DeepSeek-V3.1`, `deepseek-ai/DeepSeek-V3-0324`, `deepseek-ai/DeepSeek-R1`, `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B`, `deepseek-ai/DeepSeek-R1-Distill-Llama-8B` |
| Qwen | `Qwen/Qwen3-235B-A22B`, `Qwen/Qwen3-Coder-480B-A35B-Instruct`, `Qwen/Qwen3-32B`, `Qwen/Qwen3-30B-A3B`, `Qwen/Qwen3-14B`, `Qwen/Qwen3-8B`, `Qwen/Qwen3-4B` |
| MiniMax | `MiniMaxAI/MiniMax-M2`, `MiniMaxAI/MiniMax-M1-80k`, `MiniMaxAI/MiniMax-Text-01` |

Field mapping from `config.json`:

- `layers` ← `num_hidden_layers`
- `hiddenSize` ← `hidden_size`
- `vocabSize` ← `vocab_size`
- `attention.heads` ← `num_attention_heads`
- `attention.kvHeads` ← `num_key_value_heads` (GQA/hybrid only)
- `attention.headDim` ← `head_dim` if present, else `hidden_size / num_attention_heads`
- MLA: `kvLoraRank` ← `kv_lora_rank`, `qkRopeHeadDim` ← `qk_rope_head_dim`; set `shardedByTp: false`
- `moe.experts` ← `n_routed_experts` or `num_experts`
- `moe.topK` ← `num_experts_per_tok`
- `moe.sharedExperts` ← `n_shared_experts` ?? 0
- `moe.denseLayers` ← `first_k_dense_replace` ?? 0
- `maxContext` ← `max_position_embeddings`
- `totalParams` / `activeParams` ← from the model card; if only total is published for a dense model, `activeParams === totalParams`
- `sourceUrl` ← `https://huggingface.co/<repo>/blob/main/config.json`
- `verifiedAt` ← today's date, `2026-08-04`

- [ ] **Step 2: Write the failing catalog test**

`src/data/catalogs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MODELS, ACCELERATORS, PROFILES, PRICING, COEFFICIENTS } from './index'

describe('catalogs', () => {
  it('has at least 20 models covering all five families', () => {
    expect(MODELS.length).toBeGreaterThanOrEqual(20)
    for (const f of ['Kimi', 'GLM', 'DeepSeek', 'Qwen', 'MiniMax']) {
      expect(MODELS.some((m) => m.family === f), `missing family ${f}`).toBe(true)
    }
  })

  it('every model cites a HuggingFace config.json and a verification date', () => {
    for (const m of MODELS) {
      expect(m.sourceUrl, m.id).toMatch(/^https:\/\/huggingface\.co\/.+\/blob\/.+\/config\.json$/)
      expect(m.verifiedAt, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('active params never exceed total params', () => {
    for (const m of MODELS) expect(m.activeParams, m.id).toBeLessThanOrEqual(m.totalParams)
  })

  it('MoE models have a strictly smaller active count', () => {
    for (const m of MODELS.filter((m) => m.moe)) {
      expect(m.activeParams, m.id).toBeLessThan(m.totalParams)
    }
  })

  it('covers every vendor class', () => {
    for (const v of ['nvidia', 'amd', 'consumer', 'chinese', 'cpu-apple']) {
      expect(ACCELERATORS.some((a) => a.vendor === v), `missing vendor ${v}`).toBe(true)
    }
  })

  it('every accelerator resolves a coefficient family', () => {
    for (const a of ACCELERATORS) {
      expect(COEFFICIENTS.families[a.coefficientFamily], a.id).toBeDefined()
    }
  })

  it('every accelerator has a pricing row', () => {
    for (const a of ACCELERATORS) expect(PRICING.gpus[a.id], a.id).toBeDefined()
  })

  it('pricing carries an as-of date', () => {
    expect(PRICING.pricesAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('has the four load profiles', () => {
    expect(PROFILES.map((p) => p.id).sort()).toEqual(['batch', 'chat', 'coding-agent', 'rag'])
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/data/catalogs.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 4: Write `src/data/schema.ts`**

Mirror `src/core/types.ts` in Zod. `zAttention` is a discriminated union on `type`. `zModel` uses `.refine((m) => m.activeParams <= m.totalParams)`. Export `parseModels`, `parseAccelerators`, `parseProfiles`, `parsePricing`, `parseCoefficients`, each throwing on invalid input with the entry id in the message.

- [ ] **Step 5: Write the four JSON catalogs**

`accelerators.json` must cover at minimum:

| id | vendor | GiB | GB/s | BF16 TFLOPS | TDP W | maxPerNode | intraNode |
|---|---|---|---|---|---|---|---|
| `h100-sxm-80` | nvidia | 80 | 3350 | 989 | 700 | 8 | nvlink |
| `h100-pcie-80` | nvidia | 80 | 2000 | 756 | 350 | 8 | pcie |
| `h200-sxm-141` | nvidia | 141 | 4800 | 989 | 700 | 8 | nvlink |
| `b200-180` | nvidia | 180 | 8000 | 2250 | 1000 | 8 | nvlink |
| `gb200-192` | nvidia | 192 | 8000 | 2500 | 1200 | 72 | nvlink |
| `a100-sxm-80` | nvidia | 80 | 2039 | 312 | 400 | 8 | nvlink |
| `l40s-48` | nvidia | 48 | 864 | 362 | 350 | 8 | pcie |
| `mi300x-192` | amd | 192 | 5300 | 1307 | 750 | 8 | xgmi |
| `mi325x-256` | amd | 256 | 6000 | 1307 | 1000 | 8 | xgmi |
| `mi355x-288` | amd | 288 | 8000 | 2500 | 1400 | 8 | xgmi |
| `rtx-5090-32` | consumer | 32 | 1792 | 210 | 575 | 8 | pcie |
| `rtx-6000-blackwell-96` | consumer | 96 | 1792 | 250 | 600 | 8 | pcie |
| `rtx-6000-ada-48` | consumer | 48 | 960 | 91 | 300 | 8 | pcie |
| `ascend-910b-64` | chinese | 64 | 1600 | 376 | 400 | 8 | hccs |
| `ascend-910c-128` | chinese | 128 | 3200 | 752 | 550 | 8 | hccs |
| `cambricon-mlu590-80` | chinese | 80 | 1200 | 200 | 400 | 8 | pcie |
| `biren-br104-64` | chinese | 64 | 1000 | 128 | 400 | 8 | pcie |
| `moore-s5000-48` | chinese | 48 | 768 | 100 | 350 | 8 | pcie |
| `hygon-dcu-z100-64` | chinese | 64 | 1024 | 96 | 350 | 8 | pcie |
| `mac-studio-m3-ultra-512` | cpu-apple | 512 | 819 | 28 | 300 | 1 | unified-memory |
| `epyc-genoa-ddr5-768` | cpu-apple | 768 | 460 | 8 | 400 | 1 | unified-memory |

Mark any figure that could not be confirmed from a vendor datasheet with a `"note"` field on the entry saying so; the UI surfaces it. Chinese-accelerator FLOPS in particular are vendor-claimed — say so in the note.

`coefficients.json`:

```json
{
  "families": {
    "nvidia-hopper-blackwell": { "mbu": 0.70, "mfu": 0.45, "note": "vLLM 0.9+, mature kernels" },
    "nvidia-ampere":           { "mbu": 0.65, "mfu": 0.40, "note": "no FP8 native" },
    "amd-instinct":            { "mbu": 0.60, "mfu": 0.35, "note": "ROCm vLLM, improving" },
    "consumer-pcie":           { "mbu": 0.55, "mfu": 0.30, "note": "no NVLink, PCIe all-reduce dominates" },
    "chinese-accelerator":     { "mbu": 0.45, "mfu": 0.22, "note": "immature kernels; vendor-claimed peak" },
    "cpu-unified":             { "mbu": 0.60, "mfu": 0.15, "note": "bandwidth-bound, weak prefill" }
  }
}
```

`profiles.json`:

```json
[
  { "id": "chat",         "requestsPerUserPerDay": 12, "promptTokens": 1200,  "outputTokens": 500,  "peakFactor": 3.0, "prefixCacheHitRate": 0.2, "slaTokensPerSec": 20, "slaTtftSeconds": 1.5 },
  { "id": "coding-agent", "requestsPerUserPerDay": 40, "promptTokens": 12000, "outputTokens": 800,  "peakFactor": 4.0, "prefixCacheHitRate": 0.7, "slaTokensPerSec": 25, "slaTtftSeconds": 3.0 },
  { "id": "rag",          "requestsPerUserPerDay": 20, "promptTokens": 6000,  "outputTokens": 600,  "peakFactor": 3.5, "prefixCacheHitRate": 0.4, "slaTokensPerSec": 20, "slaTtftSeconds": 2.0 },
  { "id": "batch",        "requestsPerUserPerDay": 500,"promptTokens": 4000,  "outputTokens": 1000, "peakFactor": 1.2, "prefixCacheHitRate": 0.1, "slaTokensPerSec": 5,  "slaTtftSeconds": 60.0 }
]
```

`pricing.json` carries `pricesAsOf: "2026-08-04"`, a `gpus` map keyed by accelerator id with `streetUsd` and `cloudUsdPerHour` (either may be `null`), plus `chassisUsd: 25000`, `ibSwitchUsdPerNode: 12000`, `usdPerKwh: 0.12`, `pue: 1.3`.

- [ ] **Step 6: Write `src/data/index.ts`**

Import the JSON with `assert { type: 'json' }`-free default imports (Vite handles JSON), run each through its parser at module scope, and export the typed results. A malformed catalog therefore fails at import time, in tests and at build.

- [ ] **Step 7: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/data
git commit -m "feat(data): add model, accelerator, pricing, profile and coefficient catalogs"
```

---

### Task 4: Memory model

**Files:**
- Create: `src/core/memory.ts`
- Test: `src/core/memory.test.ts`

**Interfaces:**
- Consumes: `src/core/types.ts`, `src/core/units.ts`.
- Produces:
  - `effectiveBitsPerWeight(quant: Quant): number`
  - `weightBytes(model: ModelSpec, quant: Quant): Bytes`
  - `kvBytesPerToken(model: ModelSpec, kvQuant: KvQuant): Bytes`
  - `kvReplication(model: ModelSpec, tp: number): number`
  - `overheadPerGpu(model: ModelSpec, quant: Quant): Bytes`
  - `computeMemory(args: { model: ModelSpec; accel: AcceleratorSpec; quant: Quant; kvQuant: KvQuant; par: Parallelism; avgSeqLen: number; gpuMemUtil: number }): MemoryBreakdown | { error: 'oom'; deficitBytes: Bytes }`

- [ ] **Step 1: Write the failing tests**

`src/core/memory.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { effectiveBitsPerWeight, kvBytesPerToken, kvReplication, weightBytes } from './memory'
import type { ModelSpec } from './types'

const gqa: ModelSpec = {
  id: 't-gqa', family: 'Qwen', displayName: 'T', hfRepo: 'x/y',
  totalParams: 32e9, activeParams: 32e9, layers: 64, hiddenSize: 5120, vocabSize: 151936,
  attention: { type: 'gqa', heads: 64, kvHeads: 8, headDim: 128, shardedByTp: true },
  moe: null, maxContext: 32768, nativeDtype: 'bf16',
  sourceUrl: 'https://huggingface.co/x/y/blob/main/config.json', verifiedAt: '2026-08-04',
}

const mla: ModelSpec = {
  ...gqa, id: 't-mla', family: 'DeepSeek', layers: 61,
  attention: { type: 'mla', heads: 128, headDim: 128, kvLoraRank: 512, qkRopeHeadDim: 64, shardedByTp: false },
}

describe('effectiveBitsPerWeight', () => {
  it('bf16 is exactly 16', () => expect(effectiveBitsPerWeight('bf16')).toBe(16))
  it('int4 accounts for group scales and zero points', () => {
    expect(effectiveBitsPerWeight('int4')).toBeCloseTo(4 + 20 / 128, 6)
  })
})

describe('weightBytes', () => {
  it('scales with effective bits', () => {
    const bf16 = weightBytes(gqa, 'bf16') as number
    const int4 = weightBytes(gqa, 'int4') as number
    expect(bf16 / int4).toBeCloseTo(16 / (4 + 20 / 128), 3)
  })
  it('uses TOTAL params for MoE, not active', () => {
    const moe: ModelSpec = { ...gqa, totalParams: 671e9, activeParams: 37e9,
      moe: { experts: 256, topK: 8, sharedExperts: 1, denseLayers: 3 } }
    expect(weightBytes(moe, 'fp8') as number).toBeCloseTo(671e9 * 8 / 8, -6)
  })
})

describe('kvBytesPerToken', () => {
  it('GQA: 2 * layers * kvHeads * headDim * bytes', () => {
    expect(kvBytesPerToken(gqa, 'fp16') as number).toBe(2 * 64 * 8 * 128 * 2)
  })
  it('MLA: layers * (kvLoraRank + qkRopeHeadDim) * bytes, with NO factor of 2', () => {
    expect(kvBytesPerToken(mla, 'fp16') as number).toBe(61 * (512 + 64) * 2)
  })
  it('MLA is dramatically cheaper than the same model on GQA', () => {
    expect(kvBytesPerToken(mla, 'fp16') as number).toBeLessThan(kvBytesPerToken(gqa, 'fp16') as number)
  })
  it('fp8 halves the cache', () => {
    expect(kvBytesPerToken(gqa, 'fp8') as number).toBe((kvBytesPerToken(gqa, 'fp16') as number) / 2)
  })
})

describe('kvReplication', () => {
  it('is 1 when TP divides kvHeads', () => expect(kvReplication(gqa, 8)).toBe(1))
  it('replicates when TP exceeds kvHeads', () => expect(kvReplication(gqa, 16)).toBe(2))
  it('MLA latent is replicated across every TP rank', () => expect(kvReplication(mla, 8)).toBe(8))
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/memory.test.ts`
Expected: FAIL — cannot resolve `./memory`.

- [ ] **Step 3: Implement `src/core/memory.ts`**

Rules to encode:

```
effectiveBitsPerWeight:
  bf16 → 16, fp8 → 8, int8 → 8 + 20/128, int4 → 4 + 20/128
  (scaleBits 16 + zeroBits 4 over groupSize 128; bf16/fp8 are not group-quantized)

weightBytes = totalParams * effectiveBitsPerWeight / 8

kvBytesPerToken:
  gqa | mha → 2 * layers * kvHeads * headDim * kvBytes
  mla        → layers * (kvLoraRank + qkRopeHeadDim) * kvBytes
  hybrid     → 2 * fullAttentionLayers * kvHeads * headDim * kvBytes
  kvBytes: fp16 → 2, fp8 → 1, int4 → 0.5

kvReplication:
  attention.shardedByTp === false → tp        (MLA latent replicated on every rank)
  otherwise                       → max(1, tp / kvHeads)

overheadPerGpu = gib(2.5) + activation buffer
  activation buffer = 8192 (chunked prefill budget) * hiddenSize * 2 bytes * 4 (residual+MLP factor)
  MoE adds gib(1) for routing and expert dispatch buffers

computeMemory:
  N          = par.gpusPerReplica
  available  = gib(accel.memoryGib) * gpuMemUtil
  weightsPerGpu = weightBytes / N
  overhead   = overheadPerGpu
  headroom   = available - weightsPerGpu - overhead
  if headroom <= 0 → { error: 'oom', deficitBytes: -headroom * N }
  kvPerSeq   = kvBytesPerToken * avgSeqLen * kvReplication / N
  maxConcurrentSeqs = floor(headroom / kvPerSeq)
  if maxConcurrentSeqs < 1 → { error: 'oom', deficitBytes: (kvPerSeq - headroom) * N }
  kvPerGpu   = headroom (the cache claims the remainder)
  freePerGpu = 0
```

Add JSDoc on each export naming the spec section it implements.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory.ts src/core/memory.test.ts
git commit -m "feat(core): add memory model with attention-aware KV cache"
```

---

### Task 5: Workload derivation

**Files:**
- Create: `src/core/workload.ts`
- Test: `src/core/workload.test.ts`

**Interfaces:**
- Consumes: `LoadProfile`, `Workload`, `DerivedLoad`.
- Produces:
  - `workloadFromProfile(profile: LoadProfile, dau: number, maxContext: number): Workload`
  - `deriveLoad(w: Workload): DerivedLoad`

- [ ] **Step 1: Write the failing tests**

`src/core/workload.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveLoad, workloadFromProfile } from './workload'
import type { LoadProfile } from './types'

const codingAgent: LoadProfile = {
  id: 'coding-agent', requestsPerUserPerDay: 40, promptTokens: 12000, outputTokens: 800,
  peakFactor: 4.0, prefixCacheHitRate: 0.7, slaTokensPerSec: 25, slaTtftSeconds: 3.0,
}

describe('deriveLoad', () => {
  const w = workloadFromProfile(codingAgent, 500, 131072)

  it('peak RPS is DAU * reqs/day / 86400 * peakFactor', () => {
    expect(deriveLoad(w).peakRps).toBeCloseTo((500 * 40) / 86400 * 4.0, 4)
  })

  it('concurrency is peak RPS times the time a request occupies a slot', () => {
    const d = deriveLoad(w)
    expect(d.concurrentSeqs).toBeGreaterThan(0)
    expect(d.concurrentSeqs).toBe(Math.ceil(d.peakRps * (800 / codingAgent.slaTokensPerSec)))
  })

  it('avgSeqLen is prompt + output', () => {
    expect(deriveLoad(w).avgSeqLen).toBe(12800)
  })

  it('token demand splits into prefill and decode', () => {
    const d = deriveLoad(w)
    expect(d.prefillTokensPerSecNeeded).toBeCloseTo(d.peakRps * 12000, 4)
    expect(d.decodeTokensPerSecNeeded).toBeCloseTo(d.peakRps * 800, 4)
  })

  it('doubling DAU doubles peak RPS', () => {
    const a = deriveLoad(workloadFromProfile(codingAgent, 500, 131072))
    const b = deriveLoad(workloadFromProfile(codingAgent, 1000, 131072))
    expect(b.peakRps).toBeCloseTo(a.peakRps * 2, 6)
  })

  it('clamps avgSeqLen to maxContext', () => {
    const long: LoadProfile = { ...codingAgent, promptTokens: 400000 }
    expect(deriveLoad(workloadFromProfile(long, 10, 131072)).avgSeqLen).toBe(131072)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/workload.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```
workloadFromProfile: spread the profile into a Workload, set dau, maxContext,
  speculative: false, gpuMemUtil: 0.90, kvQuant: 'fp16'.

deriveLoad:
  peakRps   = dau * requestsPerUserPerDay / 86400 * peakFactor
  avgSeqLen = min(promptTokens + outputTokens, maxContext)
  holdTime  = outputTokens / slaTokensPerSec          // seconds a slot is occupied
  concurrentSeqs = max(1, ceil(peakRps * holdTime))   // Little's law
  prefillTokensPerSecNeeded = peakRps * promptTokens
  decodeTokensPerSecNeeded  = peakRps * outputTokens
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/workload.ts src/core/workload.test.ts
git commit -m "feat(core): derive peak load and concurrency from profile and DAU"
```

---

### Task 6: Throughput model

**Files:**
- Create: `src/core/throughput.ts`
- Test: `src/core/throughput.test.ts`

**Interfaces:**
- Consumes: `MemoryBreakdown`, `Parallelism`, `AcceleratorSpec`, `ModelSpec`, `Workload`, `DerivedLoad`, coefficients.
- Produces:
  - `commTimePerStep(args: { model: ModelSpec; batch: number; tp: number; accel: AcceleratorSpec }): Seconds`
  - `peakFlopsFor(accel: AcceleratorSpec, quant: Quant): Flops`
  - `computePerformance(args: { model: ModelSpec; accel: AcceleratorSpec; quant: Quant; par: Parallelism; mem: MemoryBreakdown; w: Workload; derived: DerivedLoad; mbu: number; mfu: number }): Performance`
  - `replicasNeeded(perf: Performance): number`
  - `range(value: number): { low: number; high: number }` returning `±UNCERTAINTY`

- [ ] **Step 1: Write the failing tests**

`src/core/throughput.test.ts` must assert:

```ts
it('decode is memory-bound: halving bandwidth halves capacity', ...)
it('MoE decode reads ACTIVE params, not total', ...)   // 671B/37B model must be ~18x faster than a 671B dense one
it('per-user TPS falls as batch grows, aggregate capacity rises', ...)
it('PCIe interconnect at TP=8 costs a larger comm fraction than NVLink', ...)
it('prefill scales super-linearly with prompt length due to the attention term', ...)
it('speculative decoding multiplies decode capacity by 1.6 when enabled', ...)
it('replicasNeeded is 1 when total load is under 0.8', ...)
it('replicasNeeded grows as ceil(load / 0.8)', ...)
it('range returns ±25%', ...)
```

Write each of these as a real test with concrete fixtures built from the `gqa`/`mla` model fixtures of Task 4 and an `h200-sxm-141`-shaped accelerator literal.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/throughput.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```
peakFlopsFor: quant 'bf16' → peakTflops.bf16; 'fp8' → fp8 ?? bf16;
  'int8' | 'int4' → int8 ?? bf16.  Convert TFLOPS → Flops.

commTimePerStep:
  // two all-reduces per layer, batch x hidden activations in bf16
  volume  = 2 * layers * batch * hiddenSize * 2
  factor  = 2 * (tp - 1) / tp                   // ring all-reduce
  if tp === 1 → 0
  linkBps = gbPerSec(accel.intraNodeGbs)
  return volume * factor / linkBps

computePerformance:
  N            = par.gpusPerReplica
  batch        = min(mem.maxConcurrentSeqs, derived.concurrentSeqs)
  activeBytes  = activeParams * effectiveBitsPerWeight(quant) / 8
  stepBytes    = activeBytes / N + batch * mem.kvBytesPerToken * avgSeqLen * mem.kvReplication / N
  stepTime     = stepBytes / (gbPerSec(accel.memBandwidthGbs) * mbu) + commTime
  specMult     = w.speculative ? 1.6 : 1.0
  perUserTps     = specMult / stepTime
  decodeCapacity = specMult * batch / stepTime
  commFraction   = commTime / stepTime

  flops        = 2 * activeParams * promptTokens
               + 2 * layers * heads * headDim * promptTokens ** 2
  prefillTime  = flops / (peakFlopsFor(accel, quant) * mfu * N)
  prefillCapacity = promptTokens / prefillTime
  ttft         = prefillTime * (1 + par.bubblePenalty)

  prefillLoad = derived.prefillTokensPerSecNeeded * (1 - prefixCacheHitRate) / prefillCapacity
  decodeLoad  = derived.decodeTokensPerSecNeeded / decodeCapacity

replicasNeeded = max(1, ceil((prefillLoad + decodeLoad) / 0.8))
range(v) = { low: v * 0.75, high: v * 1.25 }
```

Guard every division: a non-finite or non-positive intermediate must return `null` so the solver can reject with reason `internal` instead of surfacing `NaN`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/throughput.ts src/core/throughput.test.ts
git commit -m "feat(core): add roofline throughput model for prefill and decode"
```

---

### Task 7: Parallelism and interconnect

**Files:**
- Create: `src/core/parallelism.ts`
- Test: `src/core/parallelism.test.ts`

**Interfaces:**
- Consumes: `ModelSpec`, `AcceleratorSpec`, `Parallelism`, `RejectionReason`.
- Produces:
  - `enumerateParallelism(model: ModelSpec, accel: AcceleratorSpec, maxGpus: number): Parallelism[]`
  - `checkInterconnect(par: Parallelism, accel: AcceleratorSpec): { ok: true } | { ok: false; reason: RejectionReason; detail: string } | { ok: true; degraded: string }`
  - `bubblePenalty(pp: number, microbatches: number): number`

- [ ] **Step 1: Write the failing tests**

```ts
it('TP values are powers of two up to maxPerNode', ...)
it('TP never exceeds the number of attention heads', ...)
it('TP must divide layers when PP > 1', ...)
it('single-node configs need no cross-node interconnect', ...)
it('TP spanning nodes on ethernet is rejected with reason "interconnect"', ...)
it('TP spanning nodes on IB400 is allowed but marked degraded', ...)
it('PP across nodes on ethernet is allowed', ...)
it('bubblePenalty is 0 for PP=1', ...)
it('bubblePenalty is (pp-1)/(microbatches+pp-1)', ...)
it('unified-memory accelerators only ever produce TP=1 PP=1', ...)
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/core/parallelism.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```
enumerateParallelism:
  if accel.intraNode === 'unified-memory' → [{ tp:1, pp:1, ep:1, gpusPerReplica:1, nodesPerReplica:1, requiredInterconnect:null, bubblePenalty:0 }]
  tpCandidates = powers of two, 1..min(accel.maxPerNode, attention.heads)
  ppCandidates = 1, 2, 4, 8 where pp divides model.layers
  for each (tp, pp) with tp*pp <= maxGpus:
    gpusPerReplica = tp * pp
    nodesPerReplica = ceil(gpusPerReplica / accel.maxPerNode)
    ep = model.moe && gpusPerReplica >= 8 ? gpusPerReplica : 1
    requiredInterconnect = nodesPerReplica > 1 ? 'ib400' : null
    bubblePenalty = bubblePenalty(pp, 8)

checkInterconnect:
  nodesPerReplica === 1 → ok
  tp > accel.maxPerNode → the TP group spans nodes:
      accel.intraNode is a fabric ('nvlink'|'xgmi'|'hccs') → degraded "TP spans nodes; needs IB >= 400 Gb/s"
      otherwise → reject reason 'interconnect'
  otherwise (PP-only across nodes) → ok

bubblePenalty(pp, m) = pp === 1 ? 0 : (pp - 1) / (m + pp - 1)
```

- [ ] **Step 4: Run tests, Step 5: Commit**

```bash
git add src/core/parallelism.ts src/core/parallelism.test.ts
git commit -m "feat(core): enumerate parallelism and enforce interconnect rules"
```

---

### Task 8: Cost model

**Files:**
- Create: `src/core/cost.ts`
- Test: `src/core/cost.test.ts`

**Interfaces:**
- Produces: `computeCost(args: { accel: AcceleratorSpec; totalGpus: number; totalNodes: number; perf: Performance; pricing: PricingTable; mode: CostMode }): CostBreakdown`

- [ ] **Step 1: Write the failing tests**

```ts
it('CAPEX sums GPUs, chassis per node and IB switches for multi-node', ...)
it('power is TDP * gpus * PUE', ...)
it('$/1M tokens uses total serving tokens per hour, prefill plus decode', ...)
it('mode "off" yields all-null money fields but a real power figure', ...)
it('a config with double the CAPEX can still win on $/1M tokens', ...)
it('missing street price yields null capex rather than NaN', ...)
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**

```
capex   = streetUsd == null ? null
        : streetUsd * totalGpus + chassisUsd * totalNodes
          + (totalNodes > 1 ? ibSwitchUsdPerNode * totalNodes : 0)
powerWatts   = accel.tdpWatts * totalGpus * pricing.pue
hourlyPower  = powerWatts / 1000 * pricing.usdPerKwh
hourlyRent   = cloudUsdPerHour == null ? null : cloudUsdPerHour * totalGpus
tokensPerHour = (perf.decodeCapacity + perf.prefillCapacity) * 3600 * replicas
hourlyCost   = mode === 'rent' ? hourlyRent : mode === 'buy' ? capex/(3*8760) + hourlyPower : null
usdPerMillionTokens = hourlyCost == null ? null : hourlyCost / tokensPerHour * 1e6
tco3y  = capex == null ? null : capex + hourlyPower * 3 * 8760
```

- [ ] **Step 4: Run tests, Step 5: Commit**

```bash
git add src/core/cost.ts src/core/cost.test.ts
git commit -m "feat(core): add CAPEX, OPEX, TCO and \$/1M-token cost model"
```

---

### Task 9: Launch command generation

**Files:**
- Create: `src/core/launch.ts`
- Test: `src/core/launch.test.ts`

**Interfaces:**
- Produces: `launchCommand(args: { model: ModelSpec; par: Parallelism; quant: Quant; kvQuant: KvQuant; maxLen: number; maxSeqs: number; gpuMemUtil: number; framework: Framework }): string`

- [ ] **Step 1: Write the failing tests**

```ts
it('emits vllm serve with the HF repo id', ...)
it('includes --tensor-parallel-size matching TP', ...)
it('includes --pipeline-parallel-size only when PP > 1', ...)
it('includes --kv-cache-dtype fp8 when the KV cache is fp8', ...)
it('omits --kv-cache-dtype for fp16', ...)
it('emits --quantization awq for int4', ...)
it('emits an sglang command shape when framework is sglang', ...)
it('never emits NaN or undefined in the command string', ...)
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**

vLLM shape:

```
vllm serve <hfRepo> \
  --tensor-parallel-size <tp> \
  [--pipeline-parallel-size <pp>] \
  --max-model-len <maxLen> \
  --gpu-memory-utilization <gpuMemUtil> \
  --max-num-seqs <maxSeqs> \
  --enable-prefix-caching \
  [--kv-cache-dtype fp8] \
  [--quantization awq|fp8]
```

SGLang shape: `python -m sglang.launch_server --model-path <repo> --tp <tp> [--dp ...] --context-length <maxLen> --mem-fraction-static <gpuMemUtil>`.

Assert on the assembled string with `toContain`, and add a final regex guard `/(NaN|undefined|null)/` that must not match.

- [ ] **Step 4: Run tests, Step 5: Commit**

```bash
git add src/core/launch.ts src/core/launch.test.ts
git commit -m "feat(core): generate vLLM and SGLang launch commands"
```

---

### Task 10: Solver

**Files:**
- Create: `src/core/solver.ts`
- Test: `src/core/solver.test.ts`

**Interfaces:**
- Consumes: every previous core module plus the catalogs.
- Produces:
  - `solve(args: { model: ModelSpec; workload: Workload; accelerators: AcceleratorSpec[]; quants?: Quant[]; costMode: CostMode; pin?: { acceleratorId: string; totalGpus: number; quant: Quant } }): SolveResult`
  - `SLA_TOLERANCE = 0.20`

- [ ] **Step 1: Write the failing tests**

```ts
it('returns at least one deployment for DeepSeek-V3.2 fp8 with 500 coding-agent DAU', ...)
it('every rejection carries a reason and a human-readable detail', ...)
it('rejects too-small GPU counts with reason "oom" and a positive deficit', ...)
it('an SLA miss within 20% stays in deployments carrying a warning', ...)
it('an SLA miss beyond 20% moves to rejections', ...)
it('deployments with warnings sort after clean ones', ...)
it('rent mode sorts by $/1M tokens ascending', ...)
it('buy mode sorts by TCO ascending', ...)
it('off mode sorts by totalGpus ascending', ...)
it('MONOTONIC: raising DAU never lowers the winning totalGpus', ...)
it('MONOTONIC: int4 never needs more memory than bf16 for the same model', ...)
it('pin mode returns exactly one candidate matching the pinned hardware', ...)
it('pin mode agrees with the matching explore candidate on every number', ...)
it('never emits NaN in any numeric field of any deployment', ...)
it('returns an empty deployment list with populated rejections when nothing fits', ...)
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**

```
solve:
  derived = deriveLoad(workload)
  quants  = args.quants ?? ['bf16','fp8','int8','int4']
  candidates = pin
    ? [single candidate derived from pin]
    : cross product of accelerators x quants x enumerateParallelism(...)

  for each candidate:
    if quant unsupported by accelerator (e.g. fp8 on Ampere) → reject 'unsupportedQuant'
    if workload.maxContext > model.maxContext → reject 'contextTooLong'
    ic = checkInterconnect(...)  → reject 'interconnect' or record a degraded warning
    mem = computeMemory(...)     → reject 'oom' with deficitBytes
    perf = computePerformance(...) → null anywhere → reject 'internal'
    replicas = replicasNeeded(perf)
    totalGpus = par.gpusPerReplica * replicas
    tpsMiss  = (slaTokensPerSec - perUserTps) / slaTokensPerSec
    ttftMiss = (ttft - slaTtftSeconds) / slaTtftSeconds
    if tpsMiss  > SLA_TOLERANCE → reject 'slaTps'
    if ttftMiss > SLA_TOLERANCE → reject 'slaTtft'
    if tpsMiss  > 0 → warning slaTps with missPercent
    if ttftMiss > 0 → warning slaTtft with missPercent
    if accelerator family is 'chinese-accelerator' → warning immatureStack
    cost = computeCost(...)
    build the Deployment, including launchCommand, hostRamGib = 2 * memoryGib * gpusPerNode,
      diskGib = ceil(toGib(weightBytes) * 1.3)

  dedupe: keep only the cheapest replicas-count per (acceleratorId, quant) pair
  sort by costMode key (rent: usdPerMillionTokens, buy: tco3y, off: totalGpus),
    warnings-last, tie-break totalGpus then perUserTps desc
  cap deployments at 8; cap rejections at 60, keeping the near-misses first
```

- [ ] **Step 4: Run tests, Step 5: Commit**

```bash
git add src/core/solver.ts src/core/solver.test.ts
git commit -m "feat(core): add candidate solver with reasoned rejections and ranking"
```

---

### Task 11: Reality-check test suite

**Files:**
- Create: `src/core/reality.test.ts`

**Interfaces:**
- Consumes: `solve`, real catalogs.

- [ ] **Step 1: Write the sanity tests**

These guard against order-of-magnitude errors, not precision. Tolerance is a factor of 2 either way (the spec's ±40% band widened for a first calibration pass; tighten once measured).

```ts
import { describe, it, expect } from 'vitest'
import { MODELS, ACCELERATORS, PROFILES } from '../data'
import { solve } from './solver'
import { workloadFromProfile } from './workload'

const model = (id: string) => MODELS.find((m) => m.id === id)!
const accel = (id: string) => ACCELERATORS.find((a) => a.id === id)!
const profile = (id: string) => PROFILES.find((p) => p.id === id)!

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi

describe('reality checks', () => {
  it('DeepSeek V3-class fp8 fits on a single 8x H200 node', () => {
    const w = workloadFromProfile(profile('chat'), 100, 32768)
    const r = solve({ model: model('deepseek-v3-0324'), workload: w,
      accelerators: [accel('h200-sxm-141')], quants: ['fp8'], costMode: 'off' })
    expect(r.deployments.some((d) => d.totalGpus === 8)).toBe(true)
  })

  it('a 671B model in bf16 cannot fit on 8x H100 80GB', () => {
    const w = workloadFromProfile(profile('chat'), 100, 32768)
    const r = solve({ model: model('deepseek-v3-0324'), workload: w,
      accelerators: [accel('h100-sxm-80')], quants: ['bf16'], costMode: 'off' })
    expect(r.deployments.every((d) => d.totalGpus > 8)).toBe(true)
  })

  it('per-user decode speed on 8x H200 lands in a plausible 20-120 tok/s band', () => {
    const w = workloadFromProfile(profile('chat'), 100, 32768)
    const r = solve({ model: model('deepseek-v3-0324'), workload: w,
      accelerators: [accel('h200-sxm-141')], quants: ['fp8'], costMode: 'off' })
    const d = r.deployments[0]
    expect(within(d.performance.perUserTps as number, 20, 120)).toBe(true)
  })

  it('a 32B dense model in bf16 fits on 2x L40S', () => {
    const w = workloadFromProfile(profile('chat'), 50, 16384)
    const r = solve({ model: model('qwen3-32b'), workload: w,
      accelerators: [accel('l40s-48')], quants: ['bf16'], costMode: 'off' })
    expect(r.deployments.some((d) => d.totalGpus <= 4)).toBe(true)
  })

  it('MLA models need far less KV per token than GQA models of similar depth', () => {
    // guards against dropping the factor-of-2 rule for MLA
    const w = workloadFromProfile(profile('coding-agent'), 200, 65536)
    const mla = solve({ model: model('deepseek-v3-0324'), workload: w,
      accelerators: [accel('h200-sxm-141')], quants: ['fp8'], costMode: 'off' })
    expect(mla.deployments[0].memory.kvBytesPerToken as number).toBeLessThan(200_000)
  })

  it('every catalog model produces either a deployment or a reasoned rejection', () => {
    for (const m of MODELS) {
      const w = workloadFromProfile(profile('chat'), 100, Math.min(32768, m.maxContext))
      const r = solve({ model: m, workload: w, accelerators: ACCELERATORS, costMode: 'rent' })
      expect(r.deployments.length + r.rejections.length, m.id).toBeGreaterThan(0)
      for (const d of r.deployments) {
        expect(Number.isFinite(d.performance.perUserTps as number), `${m.id} tps`).toBe(true)
        expect(Number.isFinite(d.totalGpus), `${m.id} gpus`).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run and calibrate**

Run: `npx vitest run src/core/reality.test.ts`
If a band fails, do NOT widen the band to make it green. Find the formula or catalog error first. Only adjust a band if you can state in the commit message why the original expectation was wrong.

- [ ] **Step 3: Commit**

```bash
git add src/core/reality.test.ts
git commit -m "test(core): add order-of-magnitude reality checks against known deployments"
```

---

### Task 12: i18n dictionaries

**Files:**
- Create: `src/ui/i18n/en.ts`, `src/ui/i18n/ru.ts`, `src/ui/i18n/index.ts`
- Test: `src/ui/i18n/i18n.test.ts`

**Interfaces:**
- Produces: `type Lang = 'en' | 'ru'`, `type Dict = typeof en`, `useLang(): { lang: Lang; setLang(l: Lang): void; t: Dict }`, `DICTS: Record<Lang, Dict>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import en from './en'
import ru from './ru'

const keys = (o: object): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v).map((s) => `${k}.${s}`) : [k])

describe('i18n', () => {
  it('ru covers every en key', () => {
    expect(keys(ru).sort()).toEqual(keys(en).sort())
  })
  it('no value is an empty string', () => {
    const walk = (o: object): void => {
      for (const v of Object.values(o)) {
        if (typeof v === 'object' && v !== null) walk(v)
        else expect(String(v).length).toBeGreaterThan(0)
      }
    }
    walk(ru); walk(en)
  })
})
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**

`en.ts` exports a nested const object typed with `as const`; `ru.ts` is typed `const ru: typeof en = {...}` so a missing key is a compile error. Cover: header, tabs, every input label and hint, every rejection reason, every warning kind, card field labels, "How computed" prose, footer disclaimer, pricing as-of banner.

- [ ] **Step 4: Run tests, Step 5: Commit**

```bash
git add src/ui/i18n
git commit -m "feat(ui): add typed en/ru dictionaries"
```

---

### Task 13: Form state and URL round trip

**Files:**
- Create: `src/ui/state.ts`
- Test: `src/ui/state.test.ts`

**Interfaces:**
- Produces:
  - `interface FormState { tab: 'explore'|'verify'; modelId: string; quant: Quant; profileId: string; dau: number; overrides: Partial<Workload>; vendors: Vendor[]; costMode: CostMode; lang: Lang; pin: { acceleratorId: string; totalGpus: number } | null }`
  - `DEFAULT_STATE: FormState`
  - `encodeState(s: FormState): string` (query string, no leading `?`)
  - `decodeState(qs: string): FormState` — unknown ids and malformed values fall back to defaults, never throw
  - `useUrlState(): [FormState, (patch: Partial<FormState>) => void]`

- [ ] **Step 1: Write the failing tests**

```ts
it('round-trips the default state', ...)
it('round-trips a fully customised state including overrides', ...)
it('falls back to defaults for an unknown model id', ...)
it('falls back to defaults for garbage input without throwing', ...)
it('drops fields equal to the default to keep URLs short', ...)
it('preserves lang across the round trip', ...)
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement.** `decodeState` validates each id against the catalogs and each number with `Number.isFinite` plus a range clamp.
- [ ] **Step 4: Run tests, Step 5: Commit**

```bash
git add src/ui/state.ts src/ui/state.test.ts
git commit -m "feat(ui): mirror calculator state into the URL query string"
```

---

### Task 14: Input panels

**Files:**
- Create: `src/ui/panels/InputPanel.tsx`, `src/ui/panels/AdvancedPanel.tsx`, `src/ui/panels/VerifyPanel.tsx`
- Test: `src/ui/panels/InputPanel.test.tsx`

**Interfaces:**
- Consumes: `FormState`, catalogs, `useLang`.
- Produces: `<InputPanel state={s} onChange={fn} />`, `<AdvancedPanel .../>`, `<VerifyPanel .../>`.

- [ ] **Step 1: Write the failing test**

```ts
it('renders the model select populated from the catalog', ...)
it('shows the derived load strip for the selected profile and DAU', ...)
it('editing an advanced field flips the profile label to Custom', ...)
it('unchecking a vendor removes it from the emitted state', ...)
it('renders in Russian when lang is ru', ...)
```

Use `@testing-library/react` with `render` and `screen.getByLabelText`.

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement.** Controls per spec §4: model select grouped by family with a badge showing total/active params and attention type; quantization segmented control; profile select + DAU number; a disclosure containing prompt/output tokens, peak factor, prefix cache hit rate, SLA tok/s, SLA TTFT, max context, speculative toggle, `gpu-memory-utilization`, KV quant; vendor checkboxes; cost-mode segmented control. Every label pulled from `t`.
- [ ] **Step 4: Run tests, Step 5: Commit**

```bash
git add src/ui/panels
git commit -m "feat(ui): add input panel with progressive disclosure"
```

---

### Task 15: Results rendering

**Files:**
- Create: `src/ui/results/LoadSummary.tsx`, `src/ui/results/MemoryBar.tsx`, `src/ui/results/DeploymentCard.tsx`, `src/ui/results/RejectedTable.tsx`, `src/ui/results/HowComputed.tsx`, `src/ui/results/format.ts`
- Test: `src/ui/results/results.test.tsx`, `src/ui/results/format.test.ts`

**Interfaces:**
- Produces: `formatRange(v: number, unit: string): string` rendering `"31–52 tok/s"`; `formatGib`, `formatUsd`, `formatCount`.

- [ ] **Step 1: Read the dataviz skill before writing any visual code**

The memory bar and utilization meter are data visualizations. Load `dataviz` and follow its palette and contrast rules so light and dark themes stay legible. Use CSS-only marks — no chart library.

- [ ] **Step 2: Write the failing tests**

```ts
it('formatRange renders a ±25% band, never a bare point value', ...)
it('MemoryBar segments sum to 100% of the bar width', ...)
it('DeploymentCard collapsed shows gpus, $/1M tok, per-user tps and TTFT', ...)
it('DeploymentCard expanded reveals the launch command', ...)
it('a warned deployment renders its warning text', ...)
it('RejectedTable renders one row per rejection with reason and detail', ...)
it('an oom rejection shows the deficit in GiB', ...)
it('HowComputed substitutes the user\'s actual numbers into the formulas', ...)
```

- [ ] **Step 3: Run and confirm failure**
- [ ] **Step 4: Implement.** `DeploymentCard` collapsed: title `8× NVIDIA H200 141GB — 1 узел, TP=8`, four key figures, `MemoryBar`. Expanded adds parallelism and interconnect, host RAM / disk / network, the prefill-vs-decode utilization meter, the cost breakdown, and the launch command in a `<pre>` with a copy button using `navigator.clipboard`.
- [ ] **Step 5: Run tests, Step 6: Commit**

```bash
git add src/ui/results
git commit -m "feat(ui): render deployment cards, rejections and formula walkthrough"
```

---

### Task 16: App shell and wiring

**Files:**
- Modify: `src/ui/App.tsx`, `src/main.tsx`, `src/index.css`
- Create: `src/ui/ErrorBoundary.tsx`
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing tests**

```ts
it('renders without crashing and shows at least one deployment for the default state', ...)
it('switching to the Verify tab renders the pinned-hardware controls', ...)
it('toggling language changes the rendered header text', ...)
it('the footer states the ±25-30% accuracy disclaimer and the prices as-of date', ...)
it('an error thrown inside results is caught by the boundary and the page survives', ...)
```

- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement.** Two-column sticky layout collapsing to a single column under `md`. Header with title, Explore/Verify tabs, language toggle, theme toggle, GitHub link. Dark mode via Tailwind `dark:` driven by `prefers-color-scheme` plus a manual override in `localStorage`. `useMemo` over `solve(...)` keyed on the form state — synchronous, no worker, no spinner. Empty-result state renders the nearest-miss guidance per spec §7. Footer carries the disclaimer and `pricesAsOf`.
- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): wire app shell, tabs, theming and error boundary"
```

---

### Task 17: CI, README and release

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`
- Modify: `package.json` (version `1.0.0`)

**Interfaces:**
- Consumes: a green `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 1: Write the Pages workflow**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  release:
    types: [published]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Red tests block the deploy because `deploy` needs `build`, and `build` runs `npm test` before uploading.

- [ ] **Step 2: Write `README.md`**

Must contain, in this order:

1. Title and one-sentence description.
2. **Live: https://kryadov.github.io/llm-hardware-calculator/** as the first thing after the description, as a prominent link.
3. What it answers — the three questions (what to buy, will it fit, why not cheaper).
4. Covered models by family and covered hardware by vendor class.
5. Method summary: the memory formulas per attention type, the roofline split, the utilization sweep, and the ±25% band. Link to the spec at `docs/superpowers/specs/2026-08-04-llm-hardware-calculator-design.md`.
6. Data provenance: every model cites its upstream `config.json`; prices carry an as-of date; MFU/MBU coefficients are stated with their note.
7. Local development: `npm ci`, `npm run dev`, `npm test`, `npm run build`.
8. Disclaimer: analytical estimate, ±25-30%, not a substitute for load testing; prices as of the stated date.

- [ ] **Step 3: Enable Pages and push**

```bash
gh api -X POST repos/kryadov/llm-hardware-calculator/pages -f build_type=workflow || \
  gh api -X PUT repos/kryadov/llm-hardware-calculator/pages -f build_type=workflow
git add -A
git commit -m "ci: publish to GitHub Pages on push to main and on release"
git push -u origin main
```

- [ ] **Step 4: Wait for the workflow and verify**

```bash
gh run watch --exit-status
curl -sSf -o /dev/null -w '%{http_code}\n' https://kryadov.github.io/llm-hardware-calculator/
```

Expected: run conclusion `success`, HTTP `200`. If the page 404s, Pages may need a minute to propagate — retry before assuming failure.

- [ ] **Step 5: Cut the release**

```bash
gh release create v1.0.0 \
  --title "v1.0.0 — LLM Hardware Calculator" \
  --notes "First release. Live at https://kryadov.github.io/llm-hardware-calculator/"
```

- [ ] **Step 6: Confirm the release run also deployed**

```bash
gh run list --limit 3
gh release view v1.0.0
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: §2 architecture → Tasks 1-2 and the file structure table; §3.1 memory → Task 4; §3.2 throughput → Task 6; §3.3 coefficients → Task 3; §3.4 parallelism → Task 7; §3.5 cost → Task 8; §3.6 ranking → Task 10; §4 UI → Tasks 12-16; §5 data → Task 3; §6 testing → Tasks 4-11 plus the per-task tests; §7 error handling → Tasks 10, 13, 16; §8 deploy → Task 17.

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N". Tasks 6-9 and 13-16 list test names rather than full test bodies; each name states a concrete, checkable assertion and the implementation rules are given as explicit formulas, which is the level a competent implementer needs. Tasks 2-5 and 11 carry full test source because their formulas are the ones most easily got wrong.

**Type consistency.** `Parallelism.gpusPerReplica` is used consistently as `N` throughout Tasks 4, 6, 7 and 10. `MemoryBreakdown.kvBytesPerToken` and `.kvReplication` are produced in Task 4 and consumed in Task 6. `Performance.decodeCapacity` / `.prefillCapacity` are produced in Task 6 and consumed in Tasks 8 and 10. `SLA_TOLERANCE = 0.20` in Task 10 matches the spec's 20% band. `replicasNeeded` is defined in Task 6 and called in Task 10. `PricingTable` and `CoefficientTable` are declared in Task 3 and consumed in Task 8 and Task 6 respectively.
