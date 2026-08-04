import { describe, it, expect } from 'vitest'
import { launchCommand } from './launch'
import type { Framework, KvQuant, ModelSpec, Parallelism, Quant } from './types'

const model: ModelSpec = {
  id: 'deepseek-v3.2',
  family: 'DeepSeek',
  displayName: 'DeepSeek-V3.2',
  hfRepo: 'deepseek-ai/DeepSeek-V3.2-Exp',
  totalParams: 671e9,
  activeParams: 37e9,
  layers: 61,
  hiddenSize: 7168,
  vocabSize: 129280,
  attention: {
    type: 'mla',
    heads: 128,
    headDim: 128,
    kvLoraRank: 512,
    qkRopeHeadDim: 64,
    shardedByTp: false,
  },
  moe: { experts: 256, topK: 8, sharedExperts: 1, denseLayers: 3 },
  maxContext: 163840,
  nativeDtype: 'fp8',
  sourceUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-V3.2-Exp/blob/main/config.json',
  verifiedAt: '2026-08-04',
}

const par = (tp: number, pp: number): Parallelism => ({
  tp,
  pp,
  ep: 1,
  gpusPerReplica: tp * pp,
  nodesPerReplica: Math.ceil((tp * pp) / 8),
  requiredInterconnect: tp * pp > 8 ? 'ib400' : null,
  bubblePenalty: pp === 1 ? 0 : (pp - 1) / (8 + pp - 1),
})

const base = {
  model,
  par: par(8, 1),
  quant: 'fp8' as Quant,
  kvQuant: 'fp16' as KvQuant,
  maxLen: 131072,
  maxSeqs: 128,
  gpuMemUtil: 0.9,
  framework: 'vllm' as Framework,
}

describe('launchCommand', () => {
  it('emits vllm serve with the HF repo id', () => {
    const cmd = launchCommand(base)
    expect(cmd).toContain('vllm serve deepseek-ai/DeepSeek-V3.2-Exp')
  })

  it('includes --tensor-parallel-size matching TP', () => {
    expect(launchCommand({ ...base, par: par(8, 1) })).toContain('--tensor-parallel-size 8')
    expect(launchCommand({ ...base, par: par(4, 1) })).toContain('--tensor-parallel-size 4')
  })

  it('includes --pipeline-parallel-size only when PP > 1', () => {
    expect(launchCommand({ ...base, par: par(8, 1) })).not.toContain('--pipeline-parallel-size')
    expect(launchCommand({ ...base, par: par(8, 2) })).toContain('--pipeline-parallel-size 2')
  })

  it('includes --kv-cache-dtype fp8 when the KV cache is fp8', () => {
    expect(launchCommand({ ...base, kvQuant: 'fp8' })).toContain('--kv-cache-dtype fp8')
  })

  it('omits --kv-cache-dtype for fp16', () => {
    expect(launchCommand({ ...base, kvQuant: 'fp16' })).not.toContain('--kv-cache-dtype')
  })

  it('emits --quantization awq for int4', () => {
    expect(launchCommand({ ...base, quant: 'int4' })).toContain('--quantization awq')
    expect(launchCommand({ ...base, quant: 'fp8' })).toContain('--quantization fp8')
    expect(launchCommand({ ...base, quant: 'bf16' })).not.toContain('--quantization')
  })

  it('emits an sglang command shape when framework is sglang', () => {
    const cmd = launchCommand({ ...base, framework: 'sglang', par: par(8, 2) })
    expect(cmd).toContain('python -m sglang.launch_server')
    expect(cmd).toContain('--model-path deepseek-ai/DeepSeek-V3.2-Exp')
    expect(cmd).toContain('--tp 8')
    expect(cmd).toContain('--pp-size 2')
    expect(cmd).toContain('--context-length 131072')
    expect(cmd).toContain('--mem-fraction-static 0.90')
    expect(cmd).not.toContain('vllm serve')
  })

  it('carries the serving limits the solver computed', () => {
    const cmd = launchCommand({ ...base, maxLen: 65536, maxSeqs: 64, gpuMemUtil: 0.85 })
    expect(cmd).toContain('--max-model-len 65536')
    expect(cmd).toContain('--max-num-seqs 64')
    expect(cmd).toContain('--gpu-memory-utilization 0.85')
    expect(cmd).toContain('--enable-prefix-caching')
  })

  it('clamps degenerate numeric inputs instead of emitting them verbatim', () => {
    const cmd = launchCommand({
      ...base,
      maxLen: Number.NaN,
      maxSeqs: 0,
      gpuMemUtil: Number.POSITIVE_INFINITY,
    })
    expect(cmd).toContain('--max-num-seqs 1')
    expect(cmd).toContain('--gpu-memory-utilization 0.90')
    expect(cmd).toContain(`--max-model-len ${model.maxContext}`)
  })

  it('never emits NaN or undefined in the command string', () => {
    const quants: Quant[] = ['bf16', 'fp8', 'int8', 'int4']
    const kvQuants: KvQuant[] = ['fp16', 'fp8', 'int4']
    const frameworks: Framework[] = ['vllm', 'sglang']
    const parallelisms = [par(1, 1), par(2, 1), par(8, 1), par(8, 2), par(8, 4)]
    const degenerate = [
      { maxLen: Number.NaN, maxSeqs: Number.NaN, gpuMemUtil: Number.NaN },
      { maxLen: -1, maxSeqs: -5, gpuMemUtil: 0 },
      { maxLen: 1e9, maxSeqs: 1e6, gpuMemUtil: 2 },
      { maxLen: 131072, maxSeqs: 128, gpuMemUtil: 0.9 },
    ]

    for (const quant of quants) {
      for (const kvQuant of kvQuants) {
        for (const framework of frameworks) {
          for (const p of parallelisms) {
            for (const d of degenerate) {
              const cmd = launchCommand({ ...base, ...d, quant, kvQuant, framework, par: p })
              expect(cmd, `${framework}/${quant}/${kvQuant}/tp${p.tp}pp${p.pp}`).not.toMatch(
                /(NaN|undefined|null)/,
              )
            }
          }
        }
      }
    }
  })
})
