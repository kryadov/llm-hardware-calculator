import { describe, expect, it } from 'vitest'
import { ACCELERATORS, MODELS, PROFILES } from '../data'
import { SLA_TOLERANCE, solve } from './solver'
import type { CostMode, Deployment, RejectionReason, SolveResult, Workload } from './types'
import { workloadFromProfile } from './workload'

const model = (id: string) => {
  const m = MODELS.find((x) => x.id === id)
  if (!m) throw new Error(`no model ${id}`)
  return m
}
const accel = (id: string) => {
  const a = ACCELERATORS.find((x) => x.id === id)
  if (!a) throw new Error(`no accelerator ${id}`)
  return a
}
const profile = (id: string) => {
  const p = PROFILES.find((x) => x.id === id)
  if (!p) throw new Error(`no profile ${id}`)
  return p
}

const REASONS: RejectionReason[] = [
  'oom',
  'slaTps',
  'slaTtft',
  'interconnect',
  'tpNotDivisible',
  'nodeLimit',
  'unsupportedQuant',
  'contextTooLong',
  'internal',
]

/** Recursively collects every numeric leaf of a value, with a dotted path. */
function numericLeaves(value: unknown, path = ''): Array<[string, number]> {
  if (typeof value === 'number') return [[path, value]]
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((v, i) => numericLeaves(v, `${path}[${i}]`))
  return Object.entries(value).flatMap(([k, v]) => numericLeaves(v, path ? `${path}.${k}` : k))
}

const sortKey = (d: Deployment, mode: CostMode): number => {
  if (mode === 'rent') return (d.cost.usdPerMillionTokens as number | null) ?? Number.POSITIVE_INFINITY
  if (mode === 'buy') return (d.cost.tco3y as number | null) ?? Number.POSITIVE_INFINITY
  return d.totalGpus
}

/** Asserts the result is ordered clean-first and then non-decreasing in the mode key. */
function expectOrdered(r: SolveResult, mode: CostMode): void {
  for (let i = 1; i < r.deployments.length; i++) {
    const a = r.deployments[i - 1]
    const b = r.deployments[i]
    const wa = a.warnings.length > 0 ? 1 : 0
    const wb = b.warnings.length > 0 ? 1 : 0
    expect(wa, `warned deployment at ${i - 1} precedes clean one at ${i}`).toBeLessThanOrEqual(wb)
    if (wa === wb) {
      expect(sortKey(a, mode), `${mode} key not ascending at index ${i}`).toBeLessThanOrEqual(
        sortKey(b, mode),
      )
    }
  }
}

const ds = model('deepseek-v3.2-exp')
const dsV3 = model('deepseek-v3-0324')
const kimi = model('kimi-k2-instruct')
const qwen32 = model('qwen3-32b')
const h200 = accel('h200-sxm-141')
const ascend = accel('ascend-910c-128')
const chat = profile('chat')
const coding = profile('coding-agent')

describe('solve', () => {
  it('SLA_TOLERANCE is exactly 0.20', () => {
    expect(SLA_TOLERANCE).toBe(0.2)
  })

  it('returns at least one deployment for DeepSeek-V3.2 fp8 with 500 coding-agent DAU', () => {
    const w = workloadFromProfile(coding, 500, 65536)
    const r = solve({ model: ds, workload: w, accelerators: ACCELERATORS, quants: ['fp8'], costMode: 'rent' })
    expect(r.deployments.length).toBeGreaterThan(0)
    expect(r.derived.peakRps).toBeCloseTo((500 * 40) / 86400 * 4, 6)
    for (const d of r.deployments) {
      expect(d.quant).toBe('fp8')
      expect(d.totalGpus).toBe(d.parallelism.gpusPerReplica * d.replicas)
      expect(d.launchCommand.length).toBeGreaterThan(0)
    }
  })

  it('every rejection carries a reason and a human-readable detail', () => {
    const w = workloadFromProfile(chat, 5000, 32768)
    const r = solve({ model: kimi, workload: w, accelerators: ACCELERATORS, costMode: 'buy' })
    expect(r.rejections.length).toBeGreaterThan(0)
    for (const rej of r.rejections) {
      expect(REASONS, `unknown reason ${rej.reason}`).toContain(rej.reason)
      expect(rej.detail.length, `empty detail for ${rej.acceleratorId}`).toBeGreaterThan(10)
      expect(rej.acceleratorId.length).toBeGreaterThan(0)
      expect(Number.isFinite(rej.replicas)).toBe(true)
      expect(rej.parallelism.gpusPerReplica).toBeGreaterThan(0)
    }
  })

  it('rejects too-small GPU counts with reason "oom" and a positive deficit', () => {
    const w = workloadFromProfile(chat, 100, 32768)
    const r = solve({ model: dsV3, workload: w, accelerators: [h200], quants: ['bf16'], costMode: 'off' })
    expect(r.deployments).toHaveLength(0)
    const ooms = r.rejections.filter((x) => x.reason === 'oom')
    expect(ooms.length).toBeGreaterThan(0)
    for (const o of ooms) {
      expect(o.deficitBytes as number).toBeGreaterThan(0)
      expect(Number.isFinite(o.deficitBytes as number)).toBe(true)
    }
  })

  it('an SLA miss within 20% stays in deployments carrying a warning', () => {
    const base = workloadFromProfile(chat, 1, 32768)
    const permissive: Workload = { ...base, slaTokensPerSec: 1, slaTtftSeconds: 3600 }
    const args = { model: dsV3, accelerators: [h200], quants: ['fp8'] as const, costMode: 'off' as const }
    const ref = solve({ ...args, quants: ['fp8'], workload: permissive })
    const tps = ref.deployments[0].performance.perUserTps as number
    const ttft = ref.deployments[0].performance.ttft as number

    // Ask for 11% more tokens/s than the candidate delivers -> a 10% miss.
    const tpsWarn = solve({
      ...args,
      quants: ['fp8'],
      workload: { ...permissive, slaTokensPerSec: tps / 0.9 },
    })
    expect(tpsWarn.deployments).toHaveLength(1)
    const wTps = tpsWarn.deployments[0].warnings.find((x) => x.kind === 'slaTps')
    expect(wTps, 'expected a slaTps warning').toBeDefined()
    expect(wTps?.missPercent).toBeCloseTo(10, 3)

    // Demand a TTFT 10% tighter than achieved.
    const ttftWarn = solve({
      ...args,
      quants: ['fp8'],
      workload: { ...permissive, slaTtftSeconds: ttft / 1.1 },
    })
    expect(ttftWarn.deployments).toHaveLength(1)
    const wTtft = ttftWarn.deployments[0].warnings.find((x) => x.kind === 'slaTtft')
    expect(wTtft, 'expected a slaTtft warning').toBeDefined()
    expect(wTtft?.missPercent).toBeCloseTo(10, 3)
  })

  it('an SLA miss beyond 20% moves to rejections', () => {
    const base = workloadFromProfile(chat, 1, 32768)
    const permissive: Workload = { ...base, slaTokensPerSec: 1, slaTtftSeconds: 3600 }
    const args = { model: dsV3, accelerators: [h200], quants: ['fp8'] as const, costMode: 'off' as const }
    const ref = solve({ ...args, quants: ['fp8'], workload: permissive })
    const tps = ref.deployments[0].performance.perUserTps as number
    const ttft = ref.deployments[0].performance.ttft as number

    const tpsMiss = solve({
      ...args,
      quants: ['fp8'],
      workload: { ...permissive, slaTokensPerSec: tps / 0.5 },
    })
    expect(tpsMiss.deployments).toHaveLength(0)
    const rTps = tpsMiss.rejections.find((x) => x.reason === 'slaTps')
    expect(rTps, 'expected a slaTps rejection').toBeDefined()
    expect(rTps?.actual).toBeCloseTo(tps, 6)
    expect(rTps?.required).toBeCloseTo(tps / 0.5, 6)

    const ttftMiss = solve({
      ...args,
      quants: ['fp8'],
      workload: { ...permissive, slaTtftSeconds: ttft / 2 },
    })
    expect(ttftMiss.deployments).toHaveLength(0)
    const rTtft = ttftMiss.rejections.find((x) => x.reason === 'slaTtft')
    expect(rTtft, 'expected a slaTtft rejection').toBeDefined()
    expect(rTtft?.actual).toBeCloseTo(ttft, 9)
  })

  it('deployments with warnings sort after clean ones', () => {
    const w = workloadFromProfile(chat, 100, 32768)
    const r = solve({
      model: dsV3,
      workload: w,
      accelerators: [ascend, h200],
      quants: ['fp8'],
      costMode: 'off',
    })
    expect(r.deployments.length).toBeGreaterThan(1)
    const clean = r.deployments.filter((d) => d.warnings.length === 0)
    const warned = r.deployments.filter((d) => d.warnings.length > 0)
    expect(clean.length).toBeGreaterThan(0)
    expect(warned.length).toBeGreaterThan(0)
    const lastClean = r.deployments.findLastIndex((d) => d.warnings.length === 0)
    const firstWarned = r.deployments.findIndex((d) => d.warnings.length > 0)
    expect(lastClean).toBeLessThan(firstWarned)
    expect(warned.some((d) => d.warnings.some((x) => x.kind === 'immatureStack'))).toBe(true)
  })

  it('rent mode sorts by $/1M tokens ascending', () => {
    const w = workloadFromProfile(coding, 500, 65536)
    const r = solve({ model: ds, workload: w, accelerators: ACCELERATORS, costMode: 'rent' })
    expect(r.deployments.length).toBeGreaterThan(1)
    expectOrdered(r, 'rent')
  })

  it('buy mode sorts by TCO ascending', () => {
    const w = workloadFromProfile(coding, 500, 65536)
    const r = solve({ model: ds, workload: w, accelerators: ACCELERATORS, costMode: 'buy' })
    expect(r.deployments.length).toBeGreaterThan(1)
    expectOrdered(r, 'buy')
  })

  it('off mode sorts by totalGpus ascending', () => {
    const w = workloadFromProfile(coding, 500, 65536)
    const r = solve({ model: ds, workload: w, accelerators: ACCELERATORS, costMode: 'off' })
    expect(r.deployments.length).toBeGreaterThan(1)
    expectOrdered(r, 'off')
  })

  it('MONOTONIC: raising DAU never lowers the winning totalGpus', () => {
    let previous = 0
    let seen = 0
    for (const dau of [10, 100, 500, 2_000, 10_000, 50_000, 250_000]) {
      const r = solve({
        model: dsV3,
        workload: workloadFromProfile(chat, dau, 32768),
        accelerators: [h200],
        quants: ['fp8'],
        costMode: 'off',
      })
      expect(r.deployments.length, `no deployment at DAU=${dau}`).toBeGreaterThan(0)
      const gpus = r.deployments[0].totalGpus
      expect(gpus, `DAU=${dau} lowered totalGpus`).toBeGreaterThanOrEqual(previous)
      previous = gpus
      seen++
    }
    expect(seen).toBe(7)
    expect(previous).toBeGreaterThan(8)
  })

  it('MONOTONIC: int4 never needs more memory than bf16 for the same model', () => {
    const w = workloadFromProfile(chat, 100, 32768)
    let compared = 0
    for (const m of [qwen32, model('qwen3-30b-a3b'), model('glm-4.5-air'), dsV3]) {
      for (const a of [h200, accel('mi300x-192'), accel('l40s-48')]) {
        const args = { model: m, workload: w, accelerators: [a], costMode: 'off' as const }
        const bf16 = solve({ ...args, quants: ['bf16'] })
        const int4 = solve({ ...args, quants: ['int4'] })
        if (bf16.deployments.length === 0 || int4.deployments.length === 0) continue
        const b = bf16.deployments[0]
        const i = int4.deployments[0]
        const total = (d: Deployment) =>
          (d.memory.weightsPerGpu as number) * d.parallelism.gpusPerReplica
        expect(total(i), `${m.id}/${a.id} int4 weights`).toBeLessThan(total(b))
        expect(i.parallelism.gpusPerReplica, `${m.id}/${a.id} gpus per replica`).toBeLessThanOrEqual(
          b.parallelism.gpusPerReplica,
        )
        expect(i.totalGpus, `${m.id}/${a.id} totalGpus`).toBeLessThanOrEqual(b.totalGpus)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(3)
  })

  it('pin mode returns exactly one candidate matching the pinned hardware', () => {
    const w = workloadFromProfile(chat, 100, 32768)
    const r = solve({
      model: dsV3,
      workload: w,
      accelerators: ACCELERATORS,
      costMode: 'off',
      pin: { acceleratorId: 'h200-sxm-141', totalGpus: 8, quant: 'fp8' },
    })
    expect(r.deployments).toHaveLength(1)
    const d = r.deployments[0]
    expect(d.acceleratorId).toBe('h200-sxm-141')
    expect(d.quant).toBe('fp8')
    expect(d.totalGpus).toBe(8)
    for (const rej of r.rejections) {
      expect(rej.acceleratorId).toBe('h200-sxm-141')
      expect(rej.quant).toBe('fp8')
    }
  })

  it('pin mode agrees with the matching explore candidate on every number', () => {
    const w = workloadFromProfile(chat, 100, 32768)
    const common = { model: dsV3, workload: w, costMode: 'off' as const }
    const explore = solve({ ...common, accelerators: [h200], quants: ['fp8'] })
    const win = explore.deployments[0]
    expect(win).toBeDefined()

    const pinned = solve({
      ...common,
      accelerators: ACCELERATORS,
      pin: { acceleratorId: win.acceleratorId, totalGpus: win.totalGpus, quant: win.quant },
    })
    expect(pinned.deployments).toHaveLength(1)
    const p = pinned.deployments[0]
    expect(p.parallelism).toEqual(win.parallelism)
    expect(p.replicas).toBe(win.replicas)
    expect(p.totalGpus).toBe(win.totalGpus)
    expect(p.totalNodes).toBe(win.totalNodes)
    expect(p.memory).toEqual(win.memory)
    expect(p.performance).toEqual(win.performance)
    expect(p.cost).toEqual(win.cost)
    expect(p.warnings).toEqual(win.warnings)
    expect(p.launchCommand).toBe(win.launchCommand)
    expect(p.hostRamGib).toBe(win.hostRamGib)
    expect(p.diskGib).toBe(win.diskGib)
  })

  it('never emits NaN in any numeric field of any deployment', () => {
    const modes: CostMode[] = ['buy', 'rent', 'off']
    let checked = 0
    for (const m of [ds, dsV3, kimi, qwen32, model('minimax-m1-80k'), model('glm-4.6')]) {
      for (const p of [chat, coding, profile('rag'), profile('batch')]) {
        for (const mode of modes) {
          const w = workloadFromProfile(p, 2_000, Math.min(32768, m.maxContext))
          const r = solve({ model: m, workload: w, accelerators: ACCELERATORS, costMode: mode })
          for (const d of r.deployments) {
            for (const [path, n] of numericLeaves(d)) {
              expect(Number.isFinite(n), `${m.id}/${p.id}/${mode} ${path} = ${n}`).toBe(true)
            }
            checked++
          }
          for (const rej of r.rejections) {
            for (const [path, n] of numericLeaves(rej)) {
              expect(Number.isFinite(n), `${m.id}/${p.id}/${mode} rejection ${path} = ${n}`).toBe(
                true,
              )
            }
          }
          for (const [path, n] of numericLeaves(r.derived)) {
            expect(Number.isFinite(n), `${m.id}/${p.id}/${mode} derived ${path}`).toBe(true)
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('returns an empty deployment list with populated rejections when nothing fits', () => {
    const w = workloadFromProfile(chat, 100, 32768)
    const r = solve({ model: kimi, workload: w, accelerators: [h200], quants: ['bf16'], costMode: 'off' })
    expect(r.deployments).toHaveLength(0)
    expect(r.rejections.length).toBeGreaterThan(0)
    expect(r.rejections.every((x) => x.reason === 'oom')).toBe(true)
  })
})
