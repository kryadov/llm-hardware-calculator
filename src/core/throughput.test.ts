import { describe, it, expect } from 'vitest'
import { commTimePerStep, computePerformance, peakFlopsFor, range, replicasNeeded } from './throughput'
import { kvBytesPerToken, kvReplication } from './memory'
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
import { bytes, seconds, tokensPerSec } from './units'

// ---------------------------------------------------------------- fixtures

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

/** h200-sxm-141 shaped. */
const h200: AcceleratorSpec = {
  id: 'h200-sxm-141', vendor: 'nvidia', displayName: 'H200 SXM 141GB',
  memoryGib: 141, memBandwidthGbs: 4800,
  peakTflops: { bf16: 989, fp8: 1979, int8: 1979 },
  tdpWatts: 700, maxPerNode: 8, intraNode: 'nvlink', intraNodeGbs: 900,
  frameworks: ['vllm', 'sglang'], coefficientFamily: 'nvidia-hopper-blackwell', releaseYear: 2024,
}

const MBU = 0.7
const MFU = 0.45

function par(tp: number, pp = 1, bubblePenalty = 0): Parallelism {
  return {
    tp, pp, ep: 1,
    gpusPerReplica: tp * pp,
    nodesPerReplica: 1,
    requiredInterconnect: null,
    bubblePenalty,
  }
}

function mem(model: ModelSpec, tp: number, maxConcurrentSeqs: number): MemoryBreakdown {
  return {
    weightsPerGpu: bytes(0),
    kvPerGpu: bytes(0),
    overheadPerGpu: bytes(0),
    availablePerGpu: bytes(0),
    freePerGpu: bytes(0),
    kvBytesPerToken: kvBytesPerToken(model, 'fp16'),
    maxConcurrentSeqs,
    kvReplication: kvReplication(model, tp),
  }
}

function wl(over: Partial<Workload> = {}): Workload {
  return {
    profileId: 'chat', dau: 500, requestsPerUserPerDay: 12,
    promptTokens: 2000, outputTokens: 500, peakFactor: 3, prefixCacheHitRate: 0,
    slaTokensPerSec: 20, slaTtftSeconds: 1.5, maxContext: 32768,
    speculative: false, gpuMemUtil: 0.9, kvQuant: 'fp16', ...over,
  }
}

function dl(over: Partial<DerivedLoad> = {}): DerivedLoad {
  return {
    peakRps: 1, concurrentSeqs: 1,
    decodeTokensPerSecNeeded: 500, prefillTokensPerSecNeeded: 2000,
    avgSeqLen: 2048, ...over,
  }
}

function perf(args: {
  model?: ModelSpec
  accel?: AcceleratorSpec
  quant?: Quant
  par?: Parallelism
  mem?: MemoryBreakdown
  w?: Workload
  derived?: DerivedLoad
  mbu?: number
  mfu?: number
}): Performance {
  const model = args.model ?? gqa
  const p = args.par ?? par(1)
  const r = computePerformance({
    model,
    accel: args.accel ?? h200,
    quant: args.quant ?? 'bf16',
    par: p,
    mem: args.mem ?? mem(model, p.tp, 1024),
    w: args.w ?? wl(),
    derived: args.derived ?? dl(),
    mbu: args.mbu ?? MBU,
    mfu: args.mfu ?? MFU,
  })
  if (r === null) throw new Error('computePerformance returned null for a valid fixture')
  return r
}

function perfObj(prefillLoad: number, decodeLoad: number): Performance {
  return {
    perUserTps: tokensPerSec(40),
    decodeCapacity: tokensPerSec(4000),
    prefillCapacity: tokensPerSec(40000),
    ttft: seconds(1),
    stepTime: seconds(0.025),
    prefillLoad,
    decodeLoad,
    commFraction: 0,
    batch: 32,
  }
}

// ---------------------------------------------------------------- tests

describe('peakFlopsFor', () => {
  it('converts TFLOPS to FLOP/s and falls back to bf16', () => {
    expect(peakFlopsFor(h200, 'bf16') as number).toBe(989e12)
    expect(peakFlopsFor(h200, 'fp8') as number).toBe(1979e12)
    expect(peakFlopsFor(h200, 'int4') as number).toBe(1979e12)
    const noFp8: AcceleratorSpec = { ...h200, peakTflops: { bf16: 989, fp8: null, int8: null } }
    expect(peakFlopsFor(noFp8, 'fp8') as number).toBe(989e12)
    expect(peakFlopsFor(noFp8, 'int8') as number).toBe(989e12)
  })
})

describe('commTimePerStep', () => {
  it('is zero at TP=1 and follows the ring all-reduce volume otherwise', () => {
    expect(commTimePerStep({ model: gqa, batch: 8, tp: 1, accel: h200 }) as number).toBe(0)
    const t = commTimePerStep({ model: gqa, batch: 8, tp: 8, accel: h200 }) as number
    const volume = 2 * gqa.layers * 8 * gqa.hiddenSize * 2
    expect(t).toBeCloseTo((volume * ((2 * 7) / 8)) / 900e9, 12)
  })
})

describe('decode roofline', () => {
  it('decode is memory-bound: halving bandwidth halves capacity', () => {
    const slow: AcceleratorSpec = { ...h200, memBandwidthGbs: h200.memBandwidthGbs / 2 }
    const fast = perf({ par: par(1) })
    const half = perf({ par: par(1), accel: slow })
    expect(half.decodeCapacity as number).toBeCloseTo((fast.decodeCapacity as number) / 2, 9)
    expect(half.perUserTps as number).toBeCloseTo((fast.perUserTps as number) / 2, 9)
  })

  it('MoE decode reads ACTIVE params, not total', () => {
    const dense: ModelSpec = { ...gqa, totalParams: 671e9, activeParams: 671e9 }
    const moe: ModelSpec = {
      ...gqa, totalParams: 671e9, activeParams: 37e9,
      moe: { experts: 256, topK: 8, sharedExperts: 1, denseLayers: 3 },
    }
    const p = par(8)
    const d = perf({ model: dense, par: p, quant: 'fp8', mem: mem(dense, 8, 1024) })
    const m = perf({ model: moe, par: p, quant: 'fp8', mem: mem(moe, 8, 1024) })
    const ratio = (m.perUserTps as number) / (d.perUserTps as number)
    expect(ratio).toBeGreaterThan(15)
    expect(ratio).toBeLessThan(20)
  })

  it('per-user TPS falls as batch grows, aggregate capacity rises', () => {
    const long = dl({ avgSeqLen: 32768 })
    const small = perf({ par: par(8), mem: mem(gqa, 8, 1024), derived: { ...long, concurrentSeqs: 1 } })
    const big = perf({ par: par(8), mem: mem(gqa, 8, 1024), derived: { ...long, concurrentSeqs: 64 } })
    expect(small.batch).toBe(1)
    expect(big.batch).toBe(64)
    expect(big.perUserTps as number).toBeLessThan(small.perUserTps as number)
    expect(big.decodeCapacity as number).toBeGreaterThan(small.decodeCapacity as number)
  })

  it('batch is clamped by maxConcurrentSeqs', () => {
    const p = perf({ par: par(8), mem: mem(gqa, 8, 12), derived: dl({ concurrentSeqs: 500 }) })
    expect(p.batch).toBe(12)
  })

  it('PCIe interconnect at TP=8 costs a larger comm fraction than NVLink', () => {
    const pcie: AcceleratorSpec = { ...h200, intraNode: 'pcie', intraNodeGbs: 64 }
    const derived = dl({ avgSeqLen: 32768, concurrentSeqs: 64 })
    const nv = perf({ par: par(8), mem: mem(gqa, 8, 1024), derived })
    const pc = perf({ par: par(8), accel: pcie, mem: mem(gqa, 8, 1024), derived })
    expect(pc.commFraction).toBeGreaterThan(nv.commFraction * 3)
    expect(nv.commFraction).toBeGreaterThan(0)
    expect(pc.commFraction).toBeLessThan(1)
    expect(pc.decodeCapacity as number).toBeLessThan(nv.decodeCapacity as number)
  })

  it('speculative decoding multiplies decode capacity by 1.6 when enabled', () => {
    const off = perf({ par: par(8), mem: mem(gqa, 8, 1024), w: wl({ speculative: false }) })
    const on = perf({ par: par(8), mem: mem(gqa, 8, 1024), w: wl({ speculative: true }) })
    expect((on.decodeCapacity as number) / (off.decodeCapacity as number)).toBeCloseTo(1.6, 9)
    expect((on.perUserTps as number) / (off.perUserTps as number)).toBeCloseTo(1.6, 9)
  })
})

describe('prefill roofline', () => {
  it('prefill scales super-linearly with prompt length due to the attention term', () => {
    const shortP = perf({ par: par(8), mem: mem(gqa, 8, 1024), w: wl({ promptTokens: 2000 }) })
    const longP = perf({ par: par(8), mem: mem(gqa, 8, 1024), w: wl({ promptTokens: 4000 }) })
    expect(longP.ttft as number).toBeGreaterThan(2 * (shortP.ttft as number))
    expect(longP.prefillCapacity as number).toBeLessThan(shortP.prefillCapacity as number)
  })

  it('TTFT carries the pipeline bubble penalty', () => {
    const flat = perf({ par: par(8), mem: mem(gqa, 8, 1024) })
    const piped = perf({ par: par(8, 1, 0.25), mem: mem(gqa, 8, 1024) })
    expect(piped.ttft as number).toBeCloseTo((flat.ttft as number) * 1.25, 9)
  })

  it('prefix cache hits reduce prefill load proportionally', () => {
    const cold = perf({ par: par(8), mem: mem(gqa, 8, 1024), w: wl({ prefixCacheHitRate: 0 }) })
    const warm = perf({ par: par(8), mem: mem(gqa, 8, 1024), w: wl({ prefixCacheHitRate: 0.75 }) })
    expect(warm.prefillLoad).toBeCloseTo(cold.prefillLoad * 0.25, 9)
  })
})

describe('guards', () => {
  it('returns null instead of NaN when an intermediate is degenerate', () => {
    const base = {
      model: gqa, accel: h200, quant: 'bf16' as Quant, par: par(8),
      mem: mem(gqa, 8, 1024), w: wl(), derived: dl(), mbu: MBU, mfu: MFU,
    }
    expect(computePerformance({ ...base, mbu: 0 })).toBeNull()
    expect(computePerformance({ ...base, mfu: 0 })).toBeNull()
    expect(computePerformance({ ...base, accel: { ...h200, memBandwidthGbs: 0 } })).toBeNull()
    expect(computePerformance({ ...base, accel: { ...h200, peakTflops: { bf16: 0, fp8: null, int8: null } } })).toBeNull()
    expect(computePerformance({ ...base, par: { ...par(8), gpusPerReplica: 0 } })).toBeNull()
    expect(computePerformance({ ...base, mem: mem(gqa, 8, 0) })).toBeNull()
    expect(computePerformance({ ...base, w: wl({ promptTokens: 0 }) })).toBeNull()
    expect(computePerformance({ ...base, derived: dl({ avgSeqLen: Number.NaN }) })).toBeNull()
  })

  it('produces finite numbers for the MLA fixture', () => {
    const p = perf({ model: mla, par: par(8), mem: mem(mla, 8, 1024), quant: 'fp8' })
    for (const v of [p.perUserTps as number, p.decodeCapacity as number, p.prefillCapacity as number,
      p.ttft as number, p.stepTime as number, p.prefillLoad, p.decodeLoad, p.commFraction]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('replicasNeeded', () => {
  it('replicasNeeded is 1 when total load is under 0.8', () => {
    expect(replicasNeeded(perfObj(0.3, 0.2))).toBe(1)
    expect(replicasNeeded(perfObj(0.0, 0.0))).toBe(1)
    expect(replicasNeeded(perfObj(0.4, 0.4))).toBe(1)
  })

  it('replicasNeeded grows as ceil(load / 0.8)', () => {
    expect(replicasNeeded(perfObj(0.5, 0.5))).toBe(Math.ceil(1.0 / 0.8))
    expect(replicasNeeded(perfObj(1.0, 1.0))).toBe(Math.ceil(2.0 / 0.8))
    expect(replicasNeeded(perfObj(5.0, 3.0))).toBe(Math.ceil(8.0 / 0.8))
  })
})

describe('range', () => {
  it('range returns ±25%', () => {
    expect(range(100)).toEqual({ low: 75, high: 125 })
    expect(range(0)).toEqual({ low: 0, high: 0 })
  })
})
