import { describe, it, expect } from 'vitest'
import { deriveLoad, workloadFromProfile } from './workload'
import type { LoadProfile } from './types'

const codingAgent: LoadProfile = {
  id: 'coding-agent', requestsPerUserPerDay: 40, promptTokens: 12000, outputTokens: 800,
  peakFactor: 4.0, prefixCacheHitRate: 0.7, slaTokensPerSec: 25, slaTtftSeconds: 3.0,
}

describe('deriveLoad', () => {
  const w = workloadFromProfile(codingAgent, 500, 131072)

  it('peak RPS is DAU * reqs/day / 86400 * peakFactor', () => {
    expect(deriveLoad(w).peakRps).toBeCloseTo((500 * 40) / 86400 * 4.0, 4)
  })

  it('concurrency is peak RPS times the time a request occupies a slot', () => {
    const d = deriveLoad(w)
    expect(d.concurrentSeqs).toBeGreaterThan(0)
    expect(d.concurrentSeqs).toBe(Math.ceil(d.peakRps * (800 / codingAgent.slaTokensPerSec)))
  })

  it('avgSeqLen is prompt + output', () => {
    expect(deriveLoad(w).avgSeqLen).toBe(12800)
  })

  it('token demand splits into prefill and decode', () => {
    const d = deriveLoad(w)
    expect(d.prefillTokensPerSecNeeded).toBeCloseTo(d.peakRps * 12000, 4)
    expect(d.decodeTokensPerSecNeeded).toBeCloseTo(d.peakRps * 800, 4)
  })

  it('doubling DAU doubles peak RPS', () => {
    const a = deriveLoad(workloadFromProfile(codingAgent, 500, 131072))
    const b = deriveLoad(workloadFromProfile(codingAgent, 1000, 131072))
    expect(b.peakRps).toBeCloseTo(a.peakRps * 2, 6)
  })

  it('clamps avgSeqLen to maxContext', () => {
    const long: LoadProfile = { ...codingAgent, promptTokens: 400000 }
    expect(deriveLoad(workloadFromProfile(long, 10, 131072)).avgSeqLen).toBe(131072)
  })
})
