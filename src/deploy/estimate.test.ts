import { describe, it, expect } from 'vitest'
import { MODELS, ACCELERATORS, PROFILES } from '../data'
import { solve } from '../core/solver'
import { workloadFromProfile } from '../core/workload'
import type { Deployment } from '../core/types'
import { estimateFacility } from './facility'
import { estimate } from './estimate'
import { mid, width } from './range'
import { DEFAULT_DEPLOYMENT_INPUTS } from './types'
import type { DeploymentInputs } from './types'

const model = (id: string) => MODELS.find((m) => m.id === id)!
const accel = (id: string) => ACCELERATORS.find((a) => a.id === id)!
const profile = (id: string) => PROFILES.find((p) => p.id === id)!

function solveOne(modelId: string, accelId: string, dau: number, quant: 'fp8' | 'bf16' = 'fp8') {
  const w = workloadFromProfile(profile('chat'), dau, 32768)
  const r = solve({
    model: model(modelId),
    workload: w,
    accelerators: [accel(accelId)],
    quants: [quant],
    costMode: 'rent',
  })
  const chosen = r.deployments[0]
  if (!chosen) throw new Error('no deployment found for test fixture')
  return { workload: w, chosen }
}

interface Fixture {
  modelId: string
  accelId: string
  workload: ReturnType<typeof workloadFromProfile>
  chosen: Deployment
}

function fixture(modelId: string, accelId: string, dau: number): Fixture {
  const { workload, chosen } = solveOne(modelId, accelId, dau)
  return { modelId, accelId, workload, chosen }
}

function run(f: Fixture, patch: Partial<DeploymentInputs> = {}) {
  return estimate({
    chosen: f.chosen,
    model: model(f.modelId),
    workload: f.workload,
    accel: accel(f.accelId),
    inputs: { ...DEFAULT_DEPLOYMENT_INPUTS, ...patch },
  })
}

describe('facility power sanity', () => {
  it('an 8x H100 SXM node draws on the order of 5-8 kW', () => {
    const f = estimateFacility({
      accel: accel('h100-sxm-80'),
      totalGpus: 8,
      totalNodes: 1,
      facility: 'colo',
      region: 'us',
    })
    expect(f.peakKwPerNode).toBeGreaterThan(5)
    expect(f.peakKwPerNode).toBeLessThan(8)
    expect(f.coolingClass).toBe('air')
  })

  it('a rack-scale GB200 NVL72 node needs liquid cooling', () => {
    const f = estimateFacility({
      accel: accel('gb200-192'),
      totalGpus: 72,
      totalNodes: 1,
      facility: 'colo',
      region: 'us',
    })
    expect(f.coolingClass).toBe('liquid')
  })
})

describe('estimate() reality checks', () => {
  it('the itemized hardware total is never cheaper than the cards alone', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const est = run(f)
    if (est.hardware.cardsUsd && est.hardware.totalOneTimeUsd) {
      expect(est.hardware.totalOneTimeUsd.low).toBeGreaterThanOrEqual(est.hardware.cardsUsd.low)
    }
  })

  it('doubling to dual-site doubles deployed hardware capex but not staffing', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const none = run(f, { availabilityPolicy: 'none' })
    const dual = run(f, { availabilityPolicy: 'dual-site' })

    expect(dual.hardware.cardsUsd!.low).toBeCloseTo(none.hardware.cardsUsd!.low * 2, 0)
    expect(dual.ops.monthlyStaffingUsd).toEqual(none.ops.monthlyStaffingUsd)
  })

  it('a stricter availability policy never produces a cheaper full cost', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const none = run(f, { availabilityPolicy: 'none' })
    const plus1 = run(f, { availabilityPolicy: 'n+1' })
    const dual = run(f, { availabilityPolicy: 'dual-site' })

    const m = (e: ReturnType<typeof run>) => {
      expect(e.fullUsdPerMillionTokens).not.toBeNull()
      return mid(e.fullUsdPerMillionTokens!)
    }
    expect(m(plus1)).toBeGreaterThanOrEqual(m(none))
    expect(m(dual)).toBeGreaterThanOrEqual(m(plus1))
  })

  it('every priced line item and the full total keep low <= high, for every policy', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    for (const policy of ['none', 'n+1', 'n+1-spare', 'dual-site'] as const) {
      const est = run(f, { availabilityPolicy: policy })
      expect(est.fullUsdPerMillionTokens, policy).not.toBeNull()
      expect(est.fullUsdPerMillionTokens!.low).toBeLessThanOrEqual(est.fullUsdPerMillionTokens!.high)
      for (const step of est.waterfall) {
        expect(step.usdPerMillionTokens === null || Number.isFinite(step.usdPerMillionTokens)).toBe(true)
      }
    }
  })

  it('a point override collapses that line to zero width without widening the total', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const base = run(f)
    const overridden = run(f, { overrides: { chassisUsd: 20_000 } })

    expect(width(base.hardware.chassisUsd!)).toBeGreaterThan(0)
    expect(width(overridden.hardware.chassisUsd!)).toBe(0)
    expect(overridden.hardware.chassisUsd).toEqual({ low: 20_000, high: 20_000 })
  })

  it('the delta headline: full cost is priced and at or above the page-1 cards-only figure', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const est = run(f)
    expect(est.page1UsdPerMillionTokens).not.toBeNull()
    // A fully-priced accelerator (street price + cloud rate on file) must
    // never fall back to "cannot be priced" — regression guard for a bug
    // where a structural "not applicable" zero (e.g. electricity bundled
    // into colo) was passed as `null` and poisoned the whole sum via `addM`.
    expect(est.fullUsdPerMillionTokens).not.toBeNull()
    expect(mid(est.fullUsdPerMillionTokens!)).toBeGreaterThanOrEqual(est.page1UsdPerMillionTokens!)
  })

  it('every waterfall step for a fully-priced accelerator is a real number, not null', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const est = run(f)
    for (const step of est.waterfall) {
      expect(step.usdPerMillionTokens, step.id).not.toBeNull()
    }
  })

  it('a fully-priced accelerator is priced under every facility mode', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    for (const facility of ['colo', 'on-prem', 'cloud'] as const) {
      const est = run(f, { facility })
      expect(est.fullUsdPerMillionTokens, facility).not.toBeNull()
    }
  })

  it('cloud facility mode carries no chassis/facility capex', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const est = run(f, { facility: 'cloud' })
    expect(est.hardware.totalOneTimeUsd).toEqual({ low: 0, high: 0 })
    expect(est.facility.oneTimeFacilityUsd).toEqual({ low: 0, high: 0 })
  })

  /*
   * The Deploy page shipped showing only `$/1M tokens`. A user in costMode
   * 'buy' came from a card reading $93,000 CAPEX and landed on a screen whose
   * largest number was $1.76. The absolute money was computed all along and
   * simply never surfaced.
   */
  it('reports absolute money, not only cents per million tokens', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const est = run(f, { facility: 'colo' })

    expect(est.totals.oneTimeUsd, 'a bought fleet has an up-front cost').not.toBeNull()
    expect(est.totals.oneTimeUsd!.low).toBeGreaterThan(10_000)
    expect(est.totals.monthlyUsd!.low).toBeGreaterThan(0)
    // Whatever the per-token figure is, the horizon total is real money.
    expect(est.totals.horizonTcoUsd!.low).toBeGreaterThan(est.totals.oneTimeUsd!.low)
    expect(est.totals.horizonYears).toBe(DEFAULT_DEPLOYMENT_INPUTS.horizonYears)
  })

  it('the horizon total equals up-front plus every month of the horizon', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    for (const horizonYears of [1, 3, 5]) {
      const est = run(f, { horizonYears })
      const expectedLow = est.totals.oneTimeUsd!.low + est.totals.monthlyUsd!.low * horizonYears * 12
      expect(est.totals.horizonTcoUsd!.low, `horizon ${horizonYears}y`).toBeCloseTo(expectedLow, 2)
    }
  })

  it('a longer horizon costs more, and cloud mode buys nothing up front', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const short = run(f, { horizonYears: 1 })
    const long = run(f, { horizonYears: 5 })
    expect(long.totals.horizonTcoUsd!.low).toBeGreaterThan(short.totals.horizonTcoUsd!.low)

    const cloud = run(f, { facility: 'cloud' })
    expect(cloud.totals.oneTimeUsd!.high, 'cloud buys no hardware').toBeLessThan(
      short.totals.oneTimeUsd!.low,
    )
    expect(cloud.totals.monthlyUsd!.low, 'cloud still bills monthly').toBeGreaterThan(0)
  })

  it('buy and rent totals are exposed so the comparison can be shown, not just its verdict', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const est = run(f, { facility: 'colo' })
    expect(est.breakeven).not.toBeNull()
    expect(est.breakeven!.buyTco).not.toBeNull()
    expect(est.breakeven!.rentTco).not.toBeNull()
    expect(est.breakeven!.buyTco!.low).toBeGreaterThan(0)
    expect(est.breakeven!.rentTco!.low).toBeGreaterThan(0)
  })

  it('breakeven is null in cloud mode and, when priced, buy capex is positive', () => {
    const f = fixture('deepseek-v3-0324', 'h200-sxm-141', 100)
    const cloud = run(f, { facility: 'cloud' })
    expect(cloud.breakeven).toBeNull()

    const colo = run(f, { facility: 'colo' })
    if (colo.breakeven && colo.breakeven.buyTco) {
      expect(colo.breakeven.buyTco.low).toBeGreaterThan(0)
    }
  })
})
