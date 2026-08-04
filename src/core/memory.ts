import type {
  AcceleratorSpec,
  KvQuant,
  MemoryBreakdown,
  ModelSpec,
  Parallelism,
  Quant,
} from './types'
import type { Bytes } from './units'
import { bytes, gib } from './units'

/** Group-quantization metadata cost: 16-bit scale + 4-bit zero point per 128 weights. */
const SCALE_BITS = 16
const ZERO_BITS = 4
const GROUP_SIZE = 128

/** Chunked-prefill token budget the activation buffer is sized against. */
const CHUNKED_PREFILL_BUDGET = 8192
/** Residual + MLP working-set factor applied to the activation buffer. */
const ACTIVATION_FACTOR = 4
/** Fixed per-GPU overhead: CUDA context, CUDA graphs, allocator fragmentation. */
const FIXED_OVERHEAD = gib(2.5)
/** Extra routing / expert-dispatch buffers for MoE models. */
const MOE_OVERHEAD = gib(1)

/**
 * Spec 3.1 "Веса": effective bits per stored weight, including group scale and
 * zero-point metadata. INT4 with group 128 costs ~4.16 bits, not 4.
 */
export function effectiveBitsPerWeight(quant: Quant): number {
  const metadata = (SCALE_BITS + ZERO_BITS) / GROUP_SIZE
  switch (quant) {
    case 'bf16':
      return 16
    case 'fp8':
      return 8
    case 'int8':
      return 8 + metadata
    case 'int4':
      return 4 + metadata
  }
}

/**
 * Spec 3.1 "Веса": weight footprint uses TOTAL parameters. For MoE every expert
 * is resident in memory even though only `activeParams` participate in a step.
 */
export function weightBytes(model: ModelSpec, quant: Quant): Bytes {
  return bytes((model.totalParams * effectiveBitsPerWeight(quant)) / 8)
}

/** Bytes per cached element for the KV-cache dtype. */
function kvElementBytes(kvQuant: KvQuant): number {
  switch (kvQuant) {
    case 'fp16':
      return 2
    case 'fp8':
      return 1
    case 'int4':
      return 0.5
  }
}

/**
 * Spec 3.1 "KV-cache": bytes of cache per token, driven by the attention type.
 *
 * - GQA/MHA: `2 * layers * kvHeads * headDim * kvBytes` (K and V, hence the 2)
 * - MLA:     `layers * (kvLoraRank + qkRopeHeadDim) * kvBytes` — a single latent,
 *            so there is deliberately NO factor of 2
 * - Hybrid:  only the full-attention layers hold a growing cache
 */
export function kvBytesPerToken(model: ModelSpec, kvQuant: KvQuant): Bytes {
  const e = kvElementBytes(kvQuant)
  const a = model.attention
  switch (a.type) {
    case 'mha':
    case 'gqa':
      return bytes(2 * model.layers * a.kvHeads * a.headDim * e)
    case 'mla':
      return bytes(model.layers * (a.kvLoraRank + a.qkRopeHeadDim) * e)
    case 'hybrid':
      if (a.fullAttentionType === 'mla' && a.kvLoraRank !== undefined && a.qkRopeHeadDim !== undefined)
        return bytes(a.fullAttentionLayers * (a.kvLoraRank + a.qkRopeHeadDim) * e)
      return bytes(2 * a.fullAttentionLayers * a.kvHeads * a.headDim * e)
  }
}

/**
 * Spec 3.1, two counter-intuitive corrections:
 *
 * - The MLA latent is not sharded by tensor parallelism in current runtimes, so it
 *   is replicated on every one of the `tp` ranks (`shardedByTp === false`).
 * - GQA shards KV heads across ranks, but once `tp > kvHeads` the heads must be
 *   replicated: `max(1, tp / kvHeads)`.
 */
export function kvReplication(model: ModelSpec, tp: number): number {
  const a = model.attention
  if (a.shardedByTp === false) return tp
  return Math.max(1, tp / a.kvHeads)
}

/**
 * Spec 3.1 "Оверхед": fixed per-GPU cost plus an activation buffer sized against
 * the chunked-prefill budget rather than the full prompt length.
 */
export function overheadPerGpu(model: ModelSpec, _quant: Quant): Bytes {
  const activation = CHUNKED_PREFILL_BUDGET * model.hiddenSize * 2 * ACTIVATION_FACTOR
  const moe = model.moe ? (MOE_OVERHEAD as number) : 0
  return bytes((FIXED_OVERHEAD as number) + activation + moe)
}

/**
 * Spec 3.1 "Итоговая проверка": per-GPU memory split and the reverse pass to
 * `maxConcurrentSeqs` — the number the user count actually collides with.
 */
export function computeMemory(args: {
  model: ModelSpec
  accel: AcceleratorSpec
  quant: Quant
  kvQuant: KvQuant
  par: Parallelism
  avgSeqLen: number
  gpuMemUtil: number
}): MemoryBreakdown | { error: 'oom'; deficitBytes: Bytes } {
  const { model, accel, quant, kvQuant, par, avgSeqLen, gpuMemUtil } = args
  const n = par.gpusPerReplica
  const available = (gib(accel.memoryGib) as number) * gpuMemUtil
  const weightsPerGpu = (weightBytes(model, quant) as number) / n
  const overhead = overheadPerGpu(model, quant) as number
  const headroom = available - weightsPerGpu - overhead

  if (!(headroom > 0)) {
    return { error: 'oom', deficitBytes: bytes(-headroom * n) }
  }

  const perToken = kvBytesPerToken(model, kvQuant) as number
  const replication = kvReplication(model, par.tp)
  const kvPerSeq = (perToken * avgSeqLen * replication) / n
  const maxConcurrentSeqs = Math.floor(headroom / kvPerSeq)

  if (!(maxConcurrentSeqs >= 1)) {
    return { error: 'oom', deficitBytes: bytes((kvPerSeq - headroom) * n) }
  }

  return {
    weightsPerGpu: bytes(weightsPerGpu),
    kvPerGpu: bytes(headroom),
    overheadPerGpu: bytes(overhead),
    availablePerGpu: bytes(available),
    freePerGpu: bytes(0),
    kvBytesPerToken: bytes(perToken),
    maxConcurrentSeqs,
    kvReplication: replication,
  }
}
