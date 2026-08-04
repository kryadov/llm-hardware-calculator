import { effectiveBitsPerWeight } from './memory'
import { UNCERTAINTY } from './types'
import type {
  AcceleratorSpec,
  DerivedLoad,
  MemoryBreakdown,
  ModelSpec,
  Parallelism,
  Performance,
  Quant,
  Workload,
} from './types'
import type { Flops, Seconds } from './units'
import { flops, gbPerSec, seconds, tokensPerSec } from './units'

/** Spec 3.2: headroom kept for tail latency when sizing replicas. */
export const TARGET_UTILIZATION = 0.8
/** Spec 3.2: speculative decoding / MTP multiplier, acceptance-rate dependent. */
export const SPECULATIVE_MULTIPLIER = 1.6

const isPositiveFinite = (n: number): boolean => Number.isFinite(n) && n > 0

/**
 * Spec 3.2 "Prefill": peak dense FLOP/s for the compute dtype, falling back to the
 * BF16 figure when the accelerator has no native low-precision path.
 */
export function peakFlopsFor(accel: AcceleratorSpec, quant: Quant): Flops {
  const t = accel.peakTflops
  const tf =
    quant === 'bf16' ? t.bf16
    : quant === 'fp8' ? (t.fp8 ?? t.bf16)
    : (t.int8 ?? t.bf16)
  return flops(tf * 1e12)
}

/**
 * Spec 3.2 `commTime`: two ring all-reduces per layer over the `batch × hidden`
 * activation tensor in bf16. Negligible on NVLink, dominant on PCIe at TP=8.
 */
export function commTimePerStep(args: {
  model: ModelSpec
  batch: number
  tp: number
  accel: AcceleratorSpec
}): Seconds {
  const { model, batch, tp, accel } = args
  if (tp <= 1) return seconds(0)
  const volume = 2 * model.layers * batch * model.hiddenSize * 2
  const factor = (2 * (tp - 1)) / tp
  const linkBps = gbPerSec(accel.intraNodeGbs) as number
  return seconds((volume * factor) / linkBps)
}

/**
 * Spec 3.2: decode roofline (memory-bound) and prefill roofline (compute-bound),
 * plus the utilization split that ties them back to the derived load.
 *
 * Returns `null` when any intermediate is non-finite or non-positive so the solver
 * can reject the candidate with reason `internal` instead of surfacing NaN.
 */
export function computePerformance(args: {
  model: ModelSpec
  accel: AcceleratorSpec
  quant: Quant
  par: Parallelism
  mem: MemoryBreakdown
  w: Workload
  derived: DerivedLoad
  mbu: number
  mfu: number
}): Performance | null {
  const { model, accel, quant, par, mem, w, derived, mbu, mfu } = args

  const n = par.gpusPerReplica
  if (!isPositiveFinite(n) || !isPositiveFinite(mbu) || !isPositiveFinite(mfu)) return null

  const batch = Math.min(mem.maxConcurrentSeqs, derived.concurrentSeqs)
  if (!isPositiveFinite(batch)) return null

  const avgSeqLen = derived.avgSeqLen
  const promptTokens = w.promptTokens
  if (!isPositiveFinite(avgSeqLen) || !isPositiveFinite(promptTokens)) return null

  // ---- decode: memory-bound
  const effBw = (gbPerSec(accel.memBandwidthGbs) as number) * mbu
  if (!isPositiveFinite(effBw)) return null

  const activeBytes = (model.activeParams * effectiveBitsPerWeight(quant)) / 8
  const kvBytes =
    (batch * (mem.kvBytesPerToken as number) * avgSeqLen * mem.kvReplication) / n
  const stepBytes = activeBytes / n + kvBytes
  if (!isPositiveFinite(stepBytes)) return null

  const commTime = commTimePerStep({ model, batch, tp: par.tp, accel }) as number
  if (!Number.isFinite(commTime) || commTime < 0) return null

  const stepTime = stepBytes / effBw + commTime
  if (!isPositiveFinite(stepTime)) return null

  const specMult = w.speculative ? SPECULATIVE_MULTIPLIER : 1
  const perUserTps = specMult / stepTime
  const decodeCapacity = (specMult * batch) / stepTime
  const commFraction = commTime / stepTime
  if (!isPositiveFinite(perUserTps) || !isPositiveFinite(decodeCapacity)) return null
  if (!Number.isFinite(commFraction)) return null

  // ---- prefill: compute-bound
  const a = model.attention
  const attnFlops = 2 * model.layers * a.heads * a.headDim * promptTokens ** 2
  const totalFlops = 2 * model.activeParams * promptTokens + attnFlops
  const peak = (peakFlopsFor(accel, quant) as number) * mfu * n
  if (!isPositiveFinite(totalFlops) || !isPositiveFinite(peak)) return null

  const prefillTime = totalFlops / peak
  if (!isPositiveFinite(prefillTime)) return null

  const prefillCapacity = promptTokens / prefillTime
  if (!isPositiveFinite(prefillCapacity)) return null

  const ttft = prefillTime * (1 + par.bubblePenalty)
  if (!isPositiveFinite(ttft)) return null

  // ---- utilization split
  const prefillLoad =
    (derived.prefillTokensPerSecNeeded * (1 - w.prefixCacheHitRate)) / prefillCapacity
  const decodeLoad = derived.decodeTokensPerSecNeeded / decodeCapacity
  if (!Number.isFinite(prefillLoad) || !Number.isFinite(decodeLoad)) return null
  if (prefillLoad < 0 || decodeLoad < 0) return null

  return {
    perUserTps: tokensPerSec(perUserTps),
    decodeCapacity: tokensPerSec(decodeCapacity),
    prefillCapacity: tokensPerSec(prefillCapacity),
    ttft: seconds(ttft),
    stepTime: seconds(stepTime),
    prefillLoad,
    decodeLoad,
    commFraction,
    batch,
  }
}

/**
 * Spec 3.2 "Сведение через утилизацию": how many model replicas the combined
 * prefill + decode load needs, with 20% headroom left for tail latency.
 */
export function replicasNeeded(perf: Performance): number {
  const load = perf.prefillLoad + perf.decodeLoad
  if (!Number.isFinite(load) || load <= 0) return 1
  return Math.max(1, Math.ceil(load / TARGET_UTILIZATION))
}

/**
 * Spec 3.3: every throughput-derived number is reported as a ±25% band, never a
 * bare point value.
 */
export function range(value: number): { low: number; high: number } {
  return { low: value * (1 - UNCERTAINTY), high: value * (1 + UNCERTAINTY) }
}
