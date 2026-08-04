/**
 * Zod schemas for every JSON catalog in `src/data`.
 *
 * This is the ONLY file in `src/core` or `src/data` allowed to import `zod`
 * (see the plan's Global Constraints). The schemas mirror `src/core/types.ts`
 * one-to-one; a catalog that drifts from the domain types fails at import time.
 */
import { z } from 'zod'
import type {
  AcceleratorSpec,
  LoadProfile,
  ModelSpec,
} from '../core/types'

/* ------------------------------------------------------------------ */
/* Interfaces produced by this module (plan Task 3 → Interfaces)       */
/* ------------------------------------------------------------------ */

export interface PricingTable {
  pricesAsOf: string
  gpus: Record<string, { streetUsd: number | null; cloudUsdPerHour: number | null }>
  chassisUsd: number
  ibSwitchUsdPerNode: number
  usdPerKwh: number
  pue: number
}

export interface CoefficientTable {
  families: Record<string, { mbu: number; mfu: number; note: string }>
}

/* ------------------------------------------------------------------ */
/* Primitive enums — mirror of src/core/types.ts                       */
/* ------------------------------------------------------------------ */

export const zQuant = z.enum(['bf16', 'fp8', 'int8', 'int4'])
export const zKvQuant = z.enum(['fp16', 'fp8', 'int4'])
export const zFramework = z.enum(['vllm', 'sglang'])
export const zVendor = z.enum(['nvidia', 'amd', 'consumer', 'chinese', 'cpu-apple'])
export const zInterconnect = z.enum([
  'nvlink',
  'xgmi',
  'hccs',
  'pcie',
  'ib400',
  'ib200',
  'ethernet',
  'unified-memory',
])
export const zFamily = z.enum(['Kimi', 'GLM', 'DeepSeek', 'Qwen', 'MiniMax', 'Custom'])

const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)')
const zPositive = z.number().finite().positive()
const zNonNegative = z.number().finite().nonnegative()
const zPositiveInt = z.number().int().positive()
const zFraction = z.number().min(0).max(1)

/* ------------------------------------------------------------------ */
/* Attention — discriminated union on `type`, four variants            */
/* ------------------------------------------------------------------ */

const zMhaAttention = z.object({
  type: z.literal('mha'),
  heads: zPositiveInt,
  kvHeads: zPositiveInt,
  headDim: zPositiveInt,
  shardedByTp: z.literal(true),
  slidingWindow: zPositiveInt.optional(),
})

const zGqaAttention = z.object({
  type: z.literal('gqa'),
  heads: zPositiveInt,
  kvHeads: zPositiveInt,
  headDim: zPositiveInt,
  shardedByTp: z.literal(true),
  slidingWindow: zPositiveInt.optional(),
})

const zMlaAttention = z.object({
  type: z.literal('mla'),
  heads: zPositiveInt,
  headDim: zPositiveInt,
  kvLoraRank: zPositiveInt,
  qkRopeHeadDim: zPositiveInt,
  shardedByTp: z.literal(false),
})

const zHybridAttention = z.object({
  type: z.literal('hybrid'),
  heads: zPositiveInt,
  kvHeads: zPositiveInt,
  headDim: zPositiveInt,
  fullAttentionLayers: zPositiveInt,
  linearStateBytesPerSeq: zNonNegative,
  shardedByTp: z.literal(true),
})

export const zAttention = z.discriminatedUnion('type', [
  zMhaAttention,
  zGqaAttention,
  zMlaAttention,
  zHybridAttention,
])

export const zMoeConfig = z.object({
  experts: zPositiveInt,
  topK: zPositiveInt,
  sharedExperts: z.number().int().nonnegative(),
  denseLayers: z.number().int().nonnegative(),
})

/* ------------------------------------------------------------------ */
/* Catalog entry schemas                                               */
/* ------------------------------------------------------------------ */

export const zModel = z
  .object({
    id: z.string().min(1),
    family: zFamily,
    displayName: z.string().min(1),
    hfRepo: z.string().min(1),
    totalParams: zPositive,
    activeParams: zPositive,
    layers: zPositiveInt,
    hiddenSize: zPositiveInt,
    vocabSize: zPositiveInt,
    attention: zAttention,
    moe: zMoeConfig.nullable(),
    maxContext: zPositiveInt,
    nativeDtype: zQuant,
    sourceUrl: z.string().url(),
    verifiedAt: zIsoDate,
  })
  .refine((m) => m.activeParams <= m.totalParams, {
    message: 'activeParams must not exceed totalParams',
    path: ['activeParams'],
  })

export const zAccelerator = z.object({
  id: z.string().min(1),
  vendor: zVendor,
  displayName: z.string().min(1),
  memoryGib: zPositive,
  memBandwidthGbs: zPositive,
  peakTflops: z.object({
    bf16: zPositive,
    fp8: zPositive.nullable(),
    int8: zPositive.nullable(),
  }),
  tdpWatts: zPositive,
  maxPerNode: zPositiveInt,
  intraNode: zInterconnect,
  intraNodeGbs: zPositive,
  frameworks: z.array(zFramework).min(1),
  coefficientFamily: z.string().min(1),
  releaseYear: z.number().int().min(2015).max(2100),
  note: z.string().min(1).optional(),
})

export const zProfile = z.object({
  id: z.string().min(1),
  requestsPerUserPerDay: zPositive,
  promptTokens: zPositiveInt,
  outputTokens: zPositiveInt,
  peakFactor: z.number().finite().min(1),
  prefixCacheHitRate: zFraction,
  slaTokensPerSec: zPositive,
  slaTtftSeconds: zPositive,
})

export const zGpuPrice = z.object({
  streetUsd: zPositive.nullable(),
  cloudUsdPerHour: zPositive.nullable(),
})

export const zPricing = z.object({
  pricesAsOf: zIsoDate,
  gpus: z.record(z.string(), zGpuPrice),
  chassisUsd: zNonNegative,
  ibSwitchUsdPerNode: zNonNegative,
  usdPerKwh: zPositive,
  pue: z.number().finite().min(1),
})

export const zCoefficientEntry = z.object({
  mbu: z.number().gt(0).max(1),
  mfu: z.number().gt(0).max(1),
  note: z.string().min(1),
})

export const zCoefficients = z.object({
  families: z.record(z.string(), zCoefficientEntry),
})

/* ------------------------------------------------------------------ */
/* Parsers — each throws, naming the offending entry                   */
/* ------------------------------------------------------------------ */

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((p) => String(p)).join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

function entryId(entry: unknown, index: number): string {
  if (typeof entry === 'object' && entry !== null && 'id' in entry) {
    const id = (entry as { id: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return `#${index}`
}

function parseList<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  label: string,
): z.output<S>[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${label}: expected an array, got ${typeof raw}`)
  }
  return raw.map((entry, index) => {
    const result = schema.safeParse(entry)
    if (!result.success) {
      throw new Error(`${label} "${entryId(entry, index)}" is invalid — ${formatIssues(result.error)}`)
    }
    return result.data
  })
}

function parseObject<S extends z.ZodType>(schema: S, raw: unknown, label: string): z.output<S> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const offending = result.error.issues
      .map((issue) => issue.path.map((p) => String(p)).join('.'))
      .filter((p) => p.length > 0)
    const where = offending.length > 0 ? ` "${offending[0]}"` : ''
    throw new Error(`${label}${where} is invalid — ${formatIssues(result.error)}`)
  }
  return result.data
}

/** Validates `models.json`. Throws naming the offending model id. */
export function parseModels(raw: unknown): ModelSpec[] {
  return parseList(zModel, raw, 'model') as ModelSpec[]
}

/** Validates `accelerators.json`. Throws naming the offending accelerator id. */
export function parseAccelerators(raw: unknown): AcceleratorSpec[] {
  return parseList(zAccelerator, raw, 'accelerator') as AcceleratorSpec[]
}

/** Validates `profiles.json`. Throws naming the offending profile id. */
export function parseProfiles(raw: unknown): LoadProfile[] {
  return parseList(zProfile, raw, 'profile') as LoadProfile[]
}

/** Validates `pricing.json`. Throws naming the offending gpu id. */
export function parsePricing(raw: unknown): PricingTable {
  return parseObject(zPricing, raw, 'pricing') as PricingTable
}

/** Validates `coefficients.json`. Throws naming the offending family key. */
export function parseCoefficients(raw: unknown): CoefficientTable {
  return parseObject(zCoefficients, raw, 'coefficients') as CoefficientTable
}
