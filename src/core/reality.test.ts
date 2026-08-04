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
    // The assertion above passes vacuously on an empty list, so pin down the reason too:
    // 1342 GB of bf16 weights over 8x80 GiB is short by hundreds of GiB.
    expect(r.deployments).toHaveLength(0)
    expect(r.rejections.some((x) => x.reason === 'oom')).toBe(true)
  })

  it('per-user decode speed on 8x H200 lands in a plausible 20-120 tok/s band', () => {
    // The 20-120 tok/s band describes a *loaded* node: every published per-user figure
    // for DeepSeek V3 on an 8-GPU node is measured with the batch full, because that is
    // how the model is actually served. This roofline takes MBU as a batch-independent
    // constant (spec 3.3), so it has no kernel-launch or latency floor and is roughly an
    // order of magnitude optimistic at batch 1-2 -- it reports ~690 tok/s for a single
    // stream. See the note at the bottom of this file. The DAU here is therefore chosen
    // to saturate the KV budget, and the test asserts that saturation explicitly rather
    // than trusting a magic number.
    const w = workloadFromProfile(profile('chat'), 50_000, 32768)
    const r = solve({ model: model('deepseek-v3-0324'), workload: w,
      accelerators: [accel('h200-sxm-141')], quants: ['fp8'], costMode: 'off' })
    const d = r.deployments[0]
    expect(d.parallelism.gpusPerReplica).toBe(8)
    expect(d.performance.batch, 'batch must be KV-saturated for this band to apply')
      .toBe(d.memory.maxConcurrentSeqs)
    expect(within(d.performance.perUserTps as number, 20, 120)).toBe(true)
  })

  it('aggregate decode on one 8x H200 node matches the published per-node figure', () => {
    // DeepSeek's own inference-system disclosure reports ~14.8k output tokens/s per
    // 8x H800 node. H200 carries 4.8 TB/s against H800's 3.35 TB/s, so a bandwidth-bound
    // decoder should land near 21k tok/s. Tolerance is a factor of 2, per the plan.
    const w = workloadFromProfile(profile('chat'), 50_000, 32768)
    const r = solve({ model: model('deepseek-v3-0324'), workload: w,
      accelerators: [accel('h200-sxm-141')], quants: ['fp8'], costMode: 'off' })
    const d = r.deployments[0]
    expect(d.parallelism.gpusPerReplica).toBe(8)
    expect(within(d.performance.decodeCapacity as number, 10_600, 42_400)).toBe(true)
  })

  it('a 32B dense model in bf16 fits on 2x L40S', () => {
    const w = workloadFromProfile(profile('chat'), 50, 16384)
    const r = solve({ model: model('qwen3-32b'), workload: w,
      accelerators: [accel('l40s-48')], quants: ['bf16'], costMode: 'off' })
    expect(r.deployments.some((d) => d.totalGpus <= 4)).toBe(true)
    // 32.8B x 2 bytes = 65.6 GB, so a single 48 GiB card cannot hold it and two can.
    expect(r.rejections.some((x) => x.reason === 'oom' && x.parallelism.gpusPerReplica === 1))
      .toBe(true)
  })

  it('MLA models need far less KV per token than GQA models of similar depth', () => {
    // guards against dropping the factor-of-2 rule for MLA
    const w = workloadFromProfile(profile('coding-agent'), 200, 65536)
    const mla = solve({ model: model('deepseek-v3-0324'), workload: w,
      accelerators: [accel('h200-sxm-141')], quants: ['fp8'], costMode: 'off' })
    expect(mla.deployments[0].memory.kvBytesPerToken as number).toBeLessThan(200_000)

    // ...and the comparison the name promises: a GQA model of comparable depth
    // (Qwen3-Coder-480B is 62 layers against DeepSeek V3's 61).
    const gqa = solve({ model: model('qwen3-coder-480b-a35b-instruct'), workload: w,
      accelerators: [accel('h200-sxm-141')], quants: ['fp8'], costMode: 'off' })
    expect(gqa.deployments.length).toBeGreaterThan(0)
    expect(mla.deployments[0].memory.kvBytesPerToken as number)
      .toBeLessThan(gqa.deployments[0].memory.kvBytesPerToken as number)
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

/*
 * KNOWN MODELLING GAP -- low-batch decode is optimistic.
 *
 * `computePerformance` uses a single MBU constant from `coefficients.json` for every
 * batch size, so decode step time is purely `bytes / (bandwidth x MBU)`. That is a good
 * description of a loaded node (see the two 8x H200 checks above, which agree with the
 * published per-node figure to ~11%) but there is no fixed per-step cost, so as batch
 * falls the predicted per-user speed rises without bound: batch=2 yields ~690 tok/s for
 * DeepSeek V3 on 8x H200, against a real ~40-70 tok/s.
 *
 * The fix belongs in `throughput.ts`, not here: either make MBU a function of batch, or
 * add a fixed per-step latency floor (kernel launch + MoE dispatch), which for a 61-layer
 * MoE is on the order of 10-15 ms. Until then, treat single-stream numbers as an upper
 * bound. Reported to the orchestrator alongside this suite.
 */
