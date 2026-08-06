import { describe, it, expect } from 'vitest'
import { ACCELERATORS, CHASSIS, INFRA, SOFTWARE } from './index'

const REGIONS = ['us', 'eu', 'ru', 'apac']

describe('infra catalog', () => {
  it('carries an as-of date', () => {
    expect(INFRA.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('has rates for every region', () => {
    for (const r of REGIONS) expect(INFRA.regions[r], r).toBeDefined()
  })

  it('every region rate is a low <= high band', () => {
    for (const region of Object.values(INFRA.regions)) {
      for (const [key, value] of Object.entries(region)) {
        expect(value.low, key).toBeLessThanOrEqual(value.high)
      }
    }
  })

  it('has all three cooling classes with increasing power ceilings', () => {
    for (const c of ['air', 'rear-door', 'liquid']) expect(INFRA.cooling[c], c).toBeDefined()
    expect(INFRA.cooling.air.rackPowerCeilingKw.high).toBeLessThanOrEqual(
      INFRA.cooling['rear-door'].rackPowerCeilingKw.high,
    )
    expect(INFRA.cooling['rear-door'].rackPowerCeilingKw.high).toBeLessThanOrEqual(
      INFRA.cooling.liquid.rackPowerCeilingKw.high,
    )
  })

  it('has a failure rate for every accelerator coefficient family', () => {
    for (const a of ACCELERATORS) {
      expect(INFRA.failureRates[a.coefficientFamily], a.coefficientFamily).toBeDefined()
    }
  })

  it('staffing coverage grows from business-hours to 24x7', () => {
    expect(INFRA.staffingCoverageFte['business-hours']).toBeLessThan(
      INFRA.staffingCoverageFte['24x7'],
    )
  })
})

describe('chassis catalog', () => {
  it('has a class for every intra-node fabric that appears in accelerators.json', () => {
    const fabrics = new Set(ACCELERATORS.map((a) => a.intraNode))
    fabrics.delete('unified-memory') // single-box hosts price the whole node in pricing.json
    for (const fabric of fabrics) {
      expect(
        CHASSIS.some((c) => c.appliesToIntraNode.includes(fabric)),
        fabric,
      ).toBe(true)
    }
  })

  it('every line item has low <= high', () => {
    for (const c of CHASSIS) {
      for (const item of c.lineItems) {
        expect(item.usdLow, `${c.id}: ${item.item}`).toBeLessThanOrEqual(item.usdHigh)
      }
    }
  })
})

describe('software catalog', () => {
  it('every preset assigns every component', () => {
    const ids = SOFTWARE.components.map((c) => c.id)
    for (const [preset, assignment] of Object.entries(SOFTWARE.presets)) {
      for (const id of ids) expect(assignment[id], `${preset}.${id}`).toBeDefined()
    }
  })

  it('every option has non-negative, ordered ranges', () => {
    for (const c of SOFTWARE.components) {
      for (const o of c.options) {
        expect(o.setupWeeksLow, `${c.id}/${o.kind}`).toBeLessThanOrEqual(o.setupWeeksHigh)
        expect(o.monthlyUsdLow, `${c.id}/${o.kind}`).toBeLessThanOrEqual(o.monthlyUsdHigh)
      }
    }
  })

  it('at least one component is prefix-cache sensitive and one is metering-granularity sensitive', () => {
    expect(SOFTWARE.components.some((c) => c.prefixCacheSensitive)).toBe(true)
    expect(SOFTWARE.components.some((c) => c.meteringGranularitySensitive)).toBe(true)
  })
})
