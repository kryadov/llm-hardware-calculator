import { describe, it, expect } from 'vitest'
import { bubblePenalty, checkInterconnect, enumerateParallelism } from './parallelism'
import type { AcceleratorSpec, ModelSpec, Parallelism } from './types'

const gqa: ModelSpec = {
  id: 't-gqa',
  family: 'Qwen',
  displayName: 'T-GQA',
  hfRepo: 'x/y',
  totalParams: 32e9,
  activeParams: 32e9,
  layers: 64,
  hiddenSize: 5120,
  vocabSize: 151936,
  attention: { type: 'gqa', heads: 64, kvHeads: 8, headDim: 128, shardedByTp: true },
  moe: null,
  maxContext: 32768,
  nativeDtype: 'bf16',
  sourceUrl: 'https://huggingface.co/x/y/blob/main/config.json',
  verifiedAt: '2026-08-04',
}

/** 61 layers is prime: no PP > 1 divides it. */
const mla: ModelSpec = {
  ...gqa,
  id: 't-mla',
  family: 'DeepSeek',
  layers: 61,
  totalParams: 671e9,
  activeParams: 37e9,
  moe: { experts: 256, topK: 8, sharedExperts: 1, denseLayers: 3 },
  attention: {
    type: 'mla',
    heads: 128,
    headDim: 128,
    kvLoraRank: 512,
    qkRopeHeadDim: 64,
    shardedByTp: false,
  },
}

/** Only 4 attention heads: TP can never exceed 4 regardless of maxPerNode. */
const fewHeads: ModelSpec = {
  ...gqa,
  id: 't-few-heads',
  layers: 32,
  attention: { type: 'gqa', heads: 4, kvHeads: 4, headDim: 128, shardedByTp: true },
}

const h200: AcceleratorSpec = {
  id: 'h200-sxm-141',
  vendor: 'nvidia',
  displayName: 'H200 SXM 141GB',
  memoryGib: 141,
  memBandwidthGbs: 4800,
  peakTflops: { bf16: 989, fp8: 1979, int8: 1979 },
  tdpWatts: 700,
  maxPerNode: 8,
  intraNode: 'nvlink',
  intraNodeGbs: 900,
  frameworks: ['vllm', 'sglang'],
  coefficientFamily: 'nvidia-hopper-blackwell',
  releaseYear: 2024,
}

const ethernetBox: AcceleratorSpec = {
  ...h200,
  id: 'eth-box-48',
  vendor: 'consumer',
  displayName: 'Ethernet-only box',
  memoryGib: 48,
  intraNode: 'ethernet',
  intraNodeGbs: 50,
  coefficientFamily: 'consumer-pcie',
}

const macStudio: AcceleratorSpec = {
  ...h200,
  id: 'mac-studio-m3-ultra-512',
  vendor: 'cpu-apple',
  displayName: 'Mac Studio M3 Ultra 512GB',
  memoryGib: 512,
  memBandwidthGbs: 819,
  peakTflops: { bf16: 28, fp8: null, int8: null },
  tdpWatts: 300,
  maxPerNode: 1,
  intraNode: 'unified-memory',
  intraNodeGbs: 819,
  coefficientFamily: 'cpu-unified',
}

const crossNodeTp: Parallelism = {
  tp: 16,
  pp: 1,
  ep: 1,
  gpusPerReplica: 16,
  nodesPerReplica: 2,
  requiredInterconnect: 'ib400',
  bubblePenalty: 0,
}

const crossNodePp: Parallelism = {
  tp: 8,
  pp: 2,
  ep: 1,
  gpusPerReplica: 16,
  nodesPerReplica: 2,
  requiredInterconnect: 'ib400',
  bubblePenalty: bubblePenalty(2, 8),
}

describe('enumerateParallelism', () => {
  it('TP values are powers of two up to maxPerNode', () => {
    const tps = [...new Set(enumerateParallelism(gqa, h200, 64).map((p) => p.tp))].sort(
      (a, b) => a - b,
    )
    expect(tps).toEqual([1, 2, 4, 8])
    expect(Math.max(...tps)).toBeLessThanOrEqual(h200.maxPerNode)
  })

  it('TP never exceeds the number of attention heads', () => {
    const tps = [...new Set(enumerateParallelism(fewHeads, h200, 64).map((p) => p.tp))].sort(
      (a, b) => a - b,
    )
    expect(tps).toEqual([1, 2, 4])
    for (const p of enumerateParallelism(mla, h200, 64)) {
      expect(p.tp).toBeLessThanOrEqual(mla.attention.heads)
    }
  })

  it('TP must divide layers when PP > 1', () => {
    for (const p of enumerateParallelism(gqa, h200, 64)) {
      if (p.pp > 1) expect(gqa.layers % p.pp).toBe(0)
    }
    // 61 layers is prime, so no pipeline split is legal at all
    expect(enumerateParallelism(mla, h200, 64).every((p) => p.pp === 1)).toBe(true)
  })

  it('single-node configs need no cross-node interconnect', () => {
    const pars = enumerateParallelism(gqa, h200, 8)
    expect(pars.length).toBeGreaterThan(0)
    for (const p of pars) {
      expect(p.nodesPerReplica).toBe(1)
      expect(p.requiredInterconnect).toBeNull()
      expect(checkInterconnect(p, h200)).toEqual({ ok: true })
    }
  })

  it('unified-memory accelerators only ever produce TP=1 PP=1', () => {
    const pars = enumerateParallelism(mla, macStudio, 64)
    expect(pars).toHaveLength(1)
    expect(pars[0].tp).toBe(1)
    expect(pars[0].pp).toBe(1)
    expect(pars[0].ep).toBe(1)
    expect(pars[0].gpusPerReplica).toBe(1)
    expect(pars[0].nodesPerReplica).toBe(1)
    expect(pars[0].requiredInterconnect).toBeNull()
    expect(pars[0].bubblePenalty).toBe(0)
  })
})

describe('checkInterconnect', () => {
  it('TP spanning nodes on ethernet is rejected with reason "interconnect"', () => {
    const r = checkInterconnect(crossNodeTp, ethernetBox)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected rejection')
    expect(r.reason).toBe('interconnect')
    expect(r.detail).toMatch(/TP/)
    expect(r.detail.length).toBeGreaterThan(0)
  })

  it('TP spanning nodes on IB400 is allowed but marked degraded', () => {
    const r = checkInterconnect(crossNodeTp, h200)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected acceptance')
    expect(r.degraded).toBeDefined()
    expect(r.degraded).toMatch(/400/)
  })

  it('PP across nodes on ethernet is allowed', () => {
    const r = checkInterconnect(crossNodePp, ethernetBox)
    expect(r).toEqual({ ok: true })
  })
})

describe('bubblePenalty', () => {
  it('bubblePenalty is 0 for PP=1', () => {
    expect(bubblePenalty(1, 8)).toBe(0)
  })

  it('bubblePenalty is (pp-1)/(microbatches+pp-1)', () => {
    expect(bubblePenalty(2, 8)).toBeCloseTo(1 / 9, 12)
    expect(bubblePenalty(4, 8)).toBeCloseTo(3 / 11, 12)
    expect(bubblePenalty(8, 8)).toBeCloseTo(7 / 15, 12)
  })
})
