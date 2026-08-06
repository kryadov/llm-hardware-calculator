/**
 * Honest hardware BOM — spec §5.1, §5.2, §5.5.
 *
 * Replaces the flat `chassisUsd`/`ibSwitchUsdPerNode` constants `core/cost.ts`
 * uses for the page-1 estimate with an itemized bill: host chassis by class,
 * fabric networking (switches, transceivers, frontend net), and one-time
 * shipping/install/burn-in. Computed independently of `core/cost.ts` — see
 * the module header of `estimate.ts` for why the two are not netted against
 * each other.
 */
import { CHASSIS, INFRA, PRICING } from '../data'
import type { ChassisCatalog, ChassisClass } from '../data/schema'
import type { AcceleratorSpec } from '../core/types'
import { fromRate, moneyPoint, scale, scaleM, sum, sumM } from './range'
import type { Facility, HardwareEstimate, MoneyRange, RateOverrides } from './types'

/**
 * Picks the chassis class for an accelerator's intra-node fabric (spec §5.1).
 * Unified-memory hosts (Mac Studio, CPU boxes) return `null` — the whole
 * machine is already priced as one SKU in `pricing.json`, so no separate
 * chassis line applies.
 */
export function chassisClassFor(accel: AcceleratorSpec, catalog: ChassisCatalog = CHASSIS): ChassisClass | null {
  if (accel.intraNode === 'unified-memory') return null
  if (accel.intraNode === 'nvlink' || accel.intraNode === 'xgmi' || accel.intraNode === 'hccs') {
    return catalog.find((c) => c.id === 'hgx-8') ?? null
  }
  if (accel.vendor === 'consumer') {
    return catalog.find((c) => c.id === 'consumer-diy') ?? null
  }
  return catalog.find((c) => c.id === 'pcie-8') ?? null
}

/** Sum of a chassis class's line items — the cost of ONE node's chassis. */
export function chassisUnitCost(cls: ChassisClass | null): MoneyRange {
  if (cls === null) return { low: 0, high: 0 }
  return sum(cls.lineItems.map((item) => ({ low: item.usdLow, high: item.usdHigh })))
}

export function estimateHardware(args: {
  accel: AcceleratorSpec
  totalGpus: number
  totalNodes: number
  facility: Facility
  overrides?: RateOverrides
}): HardwareEstimate {
  const { accel, totalGpus, totalNodes, facility, overrides } = args

  if (facility === 'cloud') {
    return {
      chassisClassId: null,
      cardsUsd: { low: 0, high: 0 },
      chassisUsd: { low: 0, high: 0 },
      networkingUsd: { low: 0, high: 0 },
      oneTimeMiscUsd: { low: 0, high: 0 },
      totalOneTimeUsd: { low: 0, high: 0 },
      warnings: [
        'Cloud rental: no hardware is purchased. Card cost is the rented hourly rate already ' +
          'shown on page 1, not repeated here.',
      ],
    }
  }

  const warnings: string[] = []

  const streetUsd = PRICING.gpus[accel.id]?.streetUsd ?? null
  let cardsUsd: MoneyRange = moneyPoint(streetUsd === null ? null : streetUsd * totalGpus)
  if (streetUsd === null) {
    warnings.push(`No street price for ${accel.displayName}; card cost is excluded from the total.`)
  }
  if (overrides?.cardsUsd !== undefined) cardsUsd = { low: overrides.cardsUsd, high: overrides.cardsUsd }

  const chassisClass = chassisClassFor(accel)
  let chassisUsd: MoneyRange = scaleM(chassisUnitCost(chassisClass), totalNodes)
  if (overrides?.chassisUsd !== undefined) chassisUsd = { low: overrides.chassisUsd, high: overrides.chassisUsd }

  let networkingUsd: MoneyRange = { low: 0, high: 0 }
  if (totalNodes > 1) {
    const net = INFRA.networking
    networkingUsd = sum([
      scale(fromRate(net.switchPortUsd), totalGpus),
      scale(fromRate(net.opticsPairUsdPerLink), totalGpus),
      scale(fromRate(net.frontendNetworkUsdPerNode), totalNodes),
      fromRate(net.managementSwitchUsd),
    ])
  }
  if (overrides?.networkingUsd !== undefined) {
    networkingUsd = { low: overrides.networkingUsd, high: overrides.networkingUsd }
  }

  const oneTime = INFRA.oneTime
  let oneTimeMiscUsd: MoneyRange = sum([
    scale(fromRate(oneTime.shippingCustomsUsdPerNode), totalNodes),
    scale(fromRate(oneTime.installCommissioningUsdPerNode), totalNodes),
    scale(fromRate(oneTime.burnInUsdPerNode), totalNodes),
  ])
  if (overrides?.oneTimeMiscUsd !== undefined) {
    oneTimeMiscUsd = { low: overrides.oneTimeMiscUsd, high: overrides.oneTimeMiscUsd }
  }

  const totalOneTimeUsd = sumM([cardsUsd, chassisUsd, networkingUsd, oneTimeMiscUsd])

  return {
    chassisClassId: chassisClass?.id ?? null,
    cardsUsd,
    chassisUsd,
    networkingUsd,
    oneTimeMiscUsd,
    totalOneTimeUsd,
    warnings,
  }
}

/** Chassis cost for a delta node/GPU count — used by `availability.ts` for redundancy extras. */
export function extraChassisCost(accel: AcceleratorSpec, extraNodes: number): MoneyRange {
  if (extraNodes <= 0) return { low: 0, high: 0 }
  return scaleM(chassisUnitCost(chassisClassFor(accel)), extraNodes)
}
