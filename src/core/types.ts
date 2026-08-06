import type { Bytes, Seconds, TokensPerSec, Usd, Watts } from './units'

export type AttentionType = 'mha' | 'gqa' | 'mla' | 'hybrid'
export type Quant = 'bf16' | 'fp8' | 'int8' | 'int4'
export type KvQuant = 'fp16' | 'fp8' | 'int4'
export type Framework = 'vllm' | 'sglang'
export type Vendor = 'nvidia' | 'amd' | 'consumer' | 'chinese' | 'cpu-apple'
export type Interconnect =
  | 'nvlink'
  | 'xgmi'
  | 'hccs'
  | 'pcie'
  | 'ib400'
  | 'ib200'
  | 'ethernet'
  | 'unified-memory'
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
  /** Attention used by the full-attention layers; `'gqa'` is the default for
   * backward compatibility (MiniMax M1). `'mla'` covers Kimi K3-style hybrids
   * where the full-attention layers are MLA and the rest are linear. */
  fullAttentionType?: 'gqa' | 'mla'
  /** MLA latent rank — required when `fullAttentionType === 'mla'`. */
  kvLoraRank?: number
  /** MLA RoPE head dim — required when `fullAttentionType === 'mla'`. */
  qkRopeHeadDim?: number
  linearStateBytesPerSeq: number
  shardedByTp: boolean
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
  /**
   * Short license label: "MIT", "Apache-2.0", "Modified MIT (Moonshot)".
   * Informational only — nothing branches on this string.
   */
  license?: string
  /**
   * The DOCUMENTED obligation this license attaches to commercial use, with the
   * severity that obligation actually carries. Present ⟺ such an obligation
   * exists; absent for plain MIT and Apache-2.0.
   *
   * `blocking` — commercial use is NOT granted outright: it is prohibited, or
   * conditioned on permission from the licensor. This can stop a sale.
   * `warning` — commercial use IS granted; a duty rides along (e.g. attribution
   * above a revenue/user threshold). Nothing stops the sale.
   *
   * Deliberately one field carrying its own severity, rather than a boolean plus
   * a note that can disagree with it: flagging a model as commercially
   * restricted without being able to say WHAT the restriction is, or at what
   * severity, must be unrepresentable. `src/deploy/risks.ts` keys off this field
   * alone and never inspects the `license` label.
   *
   * A vendor-named or "custom" license is NOT automatically restricted, and a
   * permissive-looking one is not automatically safe. Both directions have bitten
   * this catalog: an earlier version regex-matched the word "custom" in the label
   * and wrongly flagged all 8 GLM models (plain MIT) while silently missing
   * MiniMax M2.7 and M3, which genuinely forbid commercial use without written
   * authorization. Read the LICENSE file; never infer from the name.
   */
  licenseCommercialCondition?: {
    severity: 'warning' | 'blocking'
    detail: string
  }
  /** Where the license was read from — the repo's LICENSE, not the model card. */
  licenseSourceUrl?: string
  /** ISO date the license was last checked against `licenseSourceUrl`. */
  licenseVerifiedAt?: string
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
  /** Provenance caveat surfaced by the UI (e.g. vendor-claimed, unverified figures). */
  note?: string
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
  /**
   * Cost per million tokens counting prompt AND output, measured at saturation
   * under this workload's prefill/decode mix. Prompt-heavy workloads push this
   * far below the per-output-token figure, so it is not directly comparable to
   * an API price list — use `usdPerMillionOutputTokens` for that.
   */
  usdPerMillionTokens: Usd | null
  /**
   * Cost per million OUTPUT tokens at saturation: the whole cost of serving the
   * workload divided by the output tokens alone. This is the figure that lines
   * up with published API pricing, which bills prompt and output separately.
   */
  usdPerMillionOutputTokens: Usd | null
  /** Total tokens/sec (prompt + output) the fleet sustains at 100% utilization. */
  saturatedTokensPerSec: number
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
