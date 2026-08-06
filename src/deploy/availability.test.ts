import { describe, it, expect } from 'vitest'
import { MODELS, ACCELERATORS, PROFILES } from '../data'
import { solve } from '../core/solver'
import { workloadFromProfile } from '../core/workload'
import { checkDegradation, deployedReplicas, sparesForFleet } from './availability'

const model = (id: string) => MODELS.find((m) => m.id === id)!
const accel = (id: string) => ACCELERATORS.find((a) => a.id === id)!
const profile = (id: string) => PROFILES.find((p) => p.id === id)!

describe('deployedReplicas', () => {
  it('none keeps the baseline', () => {
    expect(deployedReplicas('none', 3)).toBe(3)
  })
  it('n+1 and n+1-spare add exactly one replica', () => {
    expect(deployedReplicas('n+1', 3)).toBe(4)
    expect(deployedReplicas('n+1-spare', 3)).toBe(4)
  })
  it('dual-site doubles the fleet', () => {
    expect(deployedReplicas('dual-site', 3)).toBe(6)
  })
})

describe('sparesForFleet', () => {
  it('scales with fleet size, failure rate and RMA window', () => {
    const spares = sparesForFleet(1000, { low: 0.03, high: 0.07 }, { low: 0.4, high: 1.5 })
    expect(spares.low).toBeGreaterThanOrEqual(0)
    expect(spares.low).toBeLessThanOrEqual(spares.high)
  })

  it('is zero for an empty fleet', () => {
    expect(sparesForFleet(0, { low: 0.05, high: 0.05 }, { low: 1, high: 1 })).toEqual({ low: 0, high: 0 })
  })

  it('a bigger fleet needs at least as many spares', () => {
    const small = sparesForFleet(100, { low: 0.05, high: 0.05 }, { low: 1, high: 1 })
    const big = sparesForFleet(10_000, { low: 0.05, high: 0.05 }, { low: 1, high: 1 })
    expect(big.high).toBeGreaterThanOrEqual(small.high)
  })
})

describe('checkDegradation', () => {
  it('a single replica losing its only node is a full outage', () => {
    const w = workloadFromProfile(profile('chat'), 100, 32768)
    const r = solve({
      model: model('deepseek-v3-0324'),
      workload: w,
      accelerators: [accel('h200-sxm-141')],
      quants: ['fp8'],
      costMode: 'off',
    })
    const chosen = r.deployments.find((d) => d.totalGpus === 8)!
    expect(chosen).toBeDefined()
    const result = checkDegradation({
      model: model('deepseek-v3-0324'),
      workload: w,
      chosen,
      deployedReplicaCount: 1,
    })
    expect(result.holdsSla).toBe(false)
    expect(result.degradedCapacityFraction).toBe(0)
  })

  it('two replicas losing one still reports a measurable capacity fraction', () => {
    const w = workloadFromProfile(profile('chat'), 50_000, 32768)
    const r = solve({
      model: model('deepseek-v3-0324'),
      workload: w,
      accelerators: [accel('h200-sxm-141')],
      quants: ['fp8'],
      costMode: 'off',
    })
    const chosen = r.deployments[0]
    const deployedReplicaCount = chosen.replicas + 1 // simulate an n+1 fleet
    const result = checkDegradation({ model: model('deepseek-v3-0324'), workload: w, chosen, deployedReplicaCount })
    expect(result.degradedCapacityFraction).toBeGreaterThanOrEqual(0)
    expect(result.degradedCapacityFraction).toBeLessThanOrEqual(1)
  })
})
