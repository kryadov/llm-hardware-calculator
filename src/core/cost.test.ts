import { describe, it, expect } from 'vitest'
import { computeCost } from './cost'
import type { AcceleratorSpec, DerivedLoad, Performance } from './types'
import type { PricingTable } from '../data/schema'
import { seconds, tokensPerSec } from './units'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

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

const ascend: AcceleratorSpec = {
  ...h200,
  id: 'ascend-910c-128',
  vendor: 'chinese',
  displayName: 'Ascend 910C 128GB',
  memoryGib: 128,
  tdpWatts: 550,
  coefficientFamily: 'chinese-accelerator',
}

const pricing: PricingTable = {
  pricesAsOf: '2026-08-04',
  gpus: {
    'h200-sxm-141': { streetUsd: 32000, cloudUsdPerHour: 3.0 },
    'ascend-910c-128': { streetUsd: null, cloudUsdPerHour: null },
    'l40s-48': { streetUsd: 8500, cloudUsdPerHour: null },
  },
  chassisUsd: 25000,
  ibSwitchUsdPerNode: 12000,
  usdPerKwh: 0.12,
  pue: 1.3,
}

const perf = (decode: number, prefill: number): Performance => ({
  perUserTps: tokensPerSec(40),
  decodeCapacity: tokensPerSec(decode),
  prefillCapacity: tokensPerSec(prefill),
  ttft: seconds(1.8),
  stepTime: seconds(0.025),
  prefillLoad: 0.4,
  decodeLoad: 0.3,
  commFraction: 0.05,
  batch: 64,
})

/** Matches `perf(...)`: prefillLoad 0.4 and decodeLoad 0.3 against those capacities. */
const derivedFor = (decode: number, prefill: number): DerivedLoad => ({
  peakRps: 1,
  concurrentSeqs: 64,
  prefillTokensPerSecNeeded: prefill * 0.4,
  decodeTokensPerSecNeeded: decode * 0.3,
  avgSeqLen: 12800,
})

const HOURS_3Y = 3 * 8760

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('computeCost', () => {
  it('CAPEX sums GPUs, chassis per node and IB switches for multi-node', () => {
    const single = computeCost({
      accel: h200,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'buy',
    })
    // 8 * 32000 + 1 * 25000, no IB switch on a single node
    expect(single.capex as number).toBeCloseTo(8 * 32000 + 25000, 6)

    const multi = computeCost({
      accel: h200,
      totalGpus: 32,
      totalNodes: 4,
      replicas: 2,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'buy',
    })
    expect(multi.capex as number).toBeCloseTo(32 * 32000 + 4 * 25000 + 4 * 12000, 6)
  })

  it('power is TDP * gpus * PUE', () => {
    const c = computeCost({
      accel: h200,
      totalGpus: 16,
      totalNodes: 2,
      replicas: 2,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'buy',
    })
    expect(c.powerWatts as number).toBeCloseTo(700 * 16 * 1.3, 6)
    expect(c.hourlyPower as number).toBeCloseTo(((700 * 16 * 1.3) / 1000) * 0.12, 9)
  })

  it('$/1M tokens prices the fleet at saturation under the workload mix', () => {
    const replicas = 3
    const c = computeCost({
      accel: h200,
      totalGpus: 24,
      totalNodes: 3,
      replicas,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'rent',
    })
    // demand = 20000*0.4 prefill + 2000*0.3 decode = 8600 tok/s at utilization 0.7
    const saturated = (8600 / 0.7) * replicas
    const hourlyRent = 3.0 * 24
    expect(c.hourlyRent as number).toBeCloseTo(hourlyRent, 9)
    expect(c.saturatedTokensPerSec).toBeCloseTo(saturated, 6)
    expect(c.usdPerMillionTokens as number).toBeCloseTo(
      (hourlyRent / (saturated * 3600)) * 1e6,
      9,
    )
  })

  it('mode "off" yields all-null money fields but a real power figure', () => {
    const c = computeCost({
      accel: h200,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'off',
    })
    expect(c.capex).toBeNull()
    expect(c.hourlyRent).toBeNull()
    expect(c.hourlyPower).toBeNull()
    expect(c.tco3y).toBeNull()
    expect(c.usdPerMillionTokens).toBeNull()
    expect(c.powerWatts as number).toBeCloseTo(700 * 8 * 1.3, 6)
  })

  it('a config with double the CAPEX can still win on $/1M tokens', () => {
    // Cheap: 8 GPUs, half the CAPEX, but only a fifth of the throughput.
    const cheap = computeCost({
      accel: h200,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: perf(500, 3000),
      derived: derivedFor(500, 3000),
      pricing,
      mode: 'buy',
    })
    // Expensive: 16 GPUs, more than double the CAPEX, ten times the throughput.
    const expensive = computeCost({
      accel: h200,
      totalGpus: 16,
      totalNodes: 2,
      replicas: 2,
      perf: perf(2500, 15000),
      derived: derivedFor(2500, 15000),
      pricing,
      mode: 'buy',
    })
    expect(expensive.capex as number).toBeGreaterThan(2 * (cheap.capex as number))
    expect(expensive.usdPerMillionTokens as number).toBeLessThan(
      cheap.usdPerMillionTokens as number,
    )
  })

  it('missing street price yields null capex rather than NaN', () => {
    const c = computeCost({
      accel: ascend,
      totalGpus: 16,
      totalNodes: 2,
      replicas: 2,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'buy',
    })
    expect(c.capex).toBeNull()
    expect(c.tco3y).toBeNull()
    expect(c.usdPerMillionTokens).toBeNull()
    // Power is physics, not price: it survives a missing price row.
    expect(c.powerWatts as number).toBeCloseTo(550 * 16 * 1.3, 6)
    expect(c.hourlyPower as number).toBeCloseTo(((550 * 16 * 1.3) / 1000) * 0.12, 9)
  })

  it('missing cloud price yields null hourlyRent and null $/1M tokens in rent mode', () => {
    const l40s: AcceleratorSpec = { ...h200, id: 'l40s-48', displayName: 'L40S 48GB' }
    const c = computeCost({
      accel: l40s,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'rent',
    })
    expect(c.hourlyRent).toBeNull()
    expect(c.usdPerMillionTokens).toBeNull()
    // Buying is still priced, and CAPEX-derived fields stay populated.
    expect(c.capex as number).toBeCloseTo(8 * 8500 + 25000, 6)
  })

  it('TCO over 3 years is CAPEX plus three years of electricity', () => {
    const c = computeCost({
      accel: h200,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'buy',
    })
    const capex = 8 * 32000 + 25000
    const hourlyPower = ((700 * 8 * 1.3) / 1000) * 0.12
    expect(c.tco3y as number).toBeCloseTo(capex + hourlyPower * HOURS_3Y, 6)
    expect(c.usdPerMillionTokens as number).toBeCloseTo(
      ((capex / HOURS_3Y + hourlyPower) / ((8600 / 0.7) * 3600)) * 1e6,
      9,
    )
  })

  it('never emits NaN in any money field, even for a degenerate zero-throughput config', () => {
    for (const mode of ['buy', 'rent', 'off'] as const) {
      const c = computeCost({
        accel: h200,
        totalGpus: 8,
        totalNodes: 1,
        replicas: 0,
        perf: perf(0, 0),
        derived: derivedFor(0, 0),
        pricing,
        mode,
      })
      for (const v of [c.capex, c.hourlyRent, c.hourlyPower, c.tco3y, c.usdPerMillionTokens]) {
        expect(v === null || Number.isFinite(v as number)).toBe(true)
      }
      expect(c.usdPerMillionTokens).toBeNull()
      expect(Number.isFinite(c.powerWatts as number)).toBe(true)
    }
  })

  it('is unaffected by an unknown accelerator id: money fields go null, power survives', () => {
    const unknown: AcceleratorSpec = { ...h200, id: 'not-in-pricing-table' }
    const c = computeCost({
      accel: unknown,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: perf(2000, 20000),
      derived: derivedFor(2000, 20000),
      pricing,
      mode: 'buy',
    })
    expect(c.capex).toBeNull()
    expect(c.hourlyRent).toBeNull()
    expect(c.tco3y).toBeNull()
    expect(c.usdPerMillionTokens).toBeNull()
    expect(c.powerWatts as number).toBeCloseTo(700 * 8 * 1.3, 6)
  })
})

/* ------------------------------------------------------------------ */
/* Saturation-based token accounting (regression: capacities were summed) */
/* ------------------------------------------------------------------ */

describe('token accounting at saturation', () => {
  const call = (decode: number, prefill: number, replicas = 1) =>
    computeCost({
      accel: h200,
      totalGpus: 8 * replicas,
      totalNodes: replicas,
      replicas,
      perf: perf(decode, prefill),
      derived: derivedFor(decode, prefill),
      pricing,
      mode: 'rent',
    })

  it('does NOT sum prefill and decode capacity — hardware cannot do both at full rate', () => {
    const c = call(2000, 20000)
    // The old bug: decodeCapacity + prefillCapacity = 22000 tok/s.
    // Truth: at a utilization of 0.7 the fleet saturates at demand/0.7.
    expect(c.saturatedTokensPerSec).toBeLessThan(2000 + 20000)
  })

  it('saturates at demand divided by utilization', () => {
    const c = call(2000, 20000)
    const demand = 20000 * 0.4 + 2000 * 0.3 // = 8600 tok/s delivered
    const utilization = 0.4 + 0.3
    expect(c.saturatedTokensPerSec).toBeCloseTo(demand / utilization, 6)
  })

  it('scales saturation linearly with replica count', () => {
    expect(call(2000, 20000, 3).saturatedTokensPerSec).toBeCloseTo(
      call(2000, 20000, 1).saturatedTokensPerSec * 3,
      6,
    )
  })

  it('reports a separate per-output-token price for API comparison', () => {
    const c = call(2000, 20000)
    expect(c.usdPerMillionOutputTokens).not.toBeNull()
    expect(c.usdPerMillionTokens).not.toBeNull()
    // Prompt tokens dominate this mix (8000 prefill vs 600 decode per second),
    // so the per-output-token price must be far higher than the blended one.
    expect(c.usdPerMillionOutputTokens as number).toBeGreaterThan(
      (c.usdPerMillionTokens as number) * 5,
    )
  })

  it('blended and output-only prices agree when there are no prompt tokens', () => {
    const c = computeCost({
      accel: h200,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: { ...perf(2000, 20000), prefillLoad: 0 },
      derived: { ...derivedFor(2000, 20000), prefillTokensPerSecNeeded: 0 },
      pricing,
      mode: 'rent',
    })
    expect(c.usdPerMillionOutputTokens as number).toBeCloseTo(c.usdPerMillionTokens as number, 6)
  })

  it('yields null prices rather than NaN when utilization is zero', () => {
    const c = computeCost({
      accel: h200,
      totalGpus: 8,
      totalNodes: 1,
      replicas: 1,
      perf: { ...perf(2000, 20000), prefillLoad: 0, decodeLoad: 0 },
      derived: { ...derivedFor(2000, 20000), prefillTokensPerSecNeeded: 0, decodeTokensPerSecNeeded: 0 },
      pricing,
      mode: 'rent',
    })
    expect(c.usdPerMillionTokens).toBeNull()
    expect(c.usdPerMillionOutputTokens).toBeNull()
    expect(Number.isFinite(c.saturatedTokensPerSec)).toBe(true)
  })
})
