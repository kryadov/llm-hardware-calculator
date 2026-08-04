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
