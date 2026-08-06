/**
 * Power, racks, cooling and facility fees — spec §5.3, §5.4.
 *
 * The one check the rest of the calculator cannot do: whether a configuration
 * physically fits in a rack. A node's peak draw picks the cheapest cooling
 * class that can carry it (air → rear-door → liquid), and that class's power
 * ceiling sets how many nodes share a rack. Racks are billed on PEAK power
 * (colocation is sold as committed capacity, not metered average) — the
 * average/peak split for the electricity bill itself lives in `ops.ts`
 * (spec §6.1).
 */
import { INFRA } from '../data'
import type { AcceleratorSpec } from '../core/types'
import { add, fromRate, mid, point, scale } from './range'
import type {
  CoolingClass,
  Facility,
  FacilityEstimate,
  MoneyRange,
  RateOverrides,
  Region,
} from './types'

/** CPU, RAM, NICs and fans draw beyond the GPUs' own TDP. */
export const HOST_POWER_OVERHEAD = 0.15

/** Cheapest cooling class whose ceiling covers one node's peak draw (spec §5.3). */
export function selectCooling(peakKwPerNode: number): CoolingClass {
  if (peakKwPerNode <= INFRA.cooling.air.rackPowerCeilingKw.high) return 'air'
  if (peakKwPerNode <= INFRA.cooling['rear-door'].rackPowerCeilingKw.high) return 'rear-door'
  return 'liquid'
}

export function estimateFacility(args: {
  accel: AcceleratorSpec
  totalGpus: number
  totalNodes: number
  facility: Facility
  region: Region
  rackPowerCeilingKwOverride?: number
  overrides?: RateOverrides
}): FacilityEstimate {
  const { accel, totalGpus, totalNodes, facility, region, rackPowerCeilingKwOverride, overrides } = args
  const warnings: string[] = []

  const gpusPerNode = totalNodes > 0 ? totalGpus / totalNodes : totalGpus
  const peakKwPerNode = (accel.tdpWatts * gpusPerNode * (1 + HOST_POWER_OVERHEAD)) / 1000
  const peakKwTotal = (accel.tdpWatts * totalGpus * (1 + HOST_POWER_OVERHEAD)) / 1000

  const coolingClass = selectCooling(peakKwPerNode)
  const rackPowerCeilingKw = rackPowerCeilingKwOverride ?? mid(fromRate(INFRA.cooling[coolingClass].rackPowerCeilingKw))
  const pue = fromRate(INFRA.cooling[coolingClass].pue)

  const fitsRackPower =
    peakKwPerNode <= (rackPowerCeilingKwOverride ?? INFRA.cooling.liquid.rackPowerCeilingKw.high)
  if (!fitsRackPower) {
    warnings.push(
      `${accel.displayName} draws ~${peakKwPerNode.toFixed(0)} kW per node — beyond what even ` +
        `liquid-cooled racks typically support (${INFRA.cooling.liquid.rackPowerCeilingKw.high} kW). ` +
        `Verify feasibility with the facility directly.`,
    )
  } else if (coolingClass === 'liquid') {
    warnings.push('Requires direct liquid cooling with a CDU — not every facility offers it.')
  } else if (coolingClass === 'rear-door') {
    warnings.push('Requires rear-door heat exchangers, not plain air cooling.')
  }

  const nodesPerRack = Math.max(1, Math.floor(rackPowerCeilingKw / Math.max(peakKwPerNode, 0.001)))
  const racks = totalNodes > 0 ? Math.ceil(totalNodes / nodesPerRack) : 0

  // Zero, not null: "no recurring facility line here" is a structural fact
  // (on-prem/cloud), not a missing price. `null` is reserved for genuinely
  // unpriced figures, because `sumM`/`addM` propagate it through every total
  // that touches this field — see the module header of `estimate.ts`.
  let monthlyFacilityUsd: MoneyRange = { low: 0, high: 0 }
  let oneTimeFacilityUsd: MoneyRange = { low: 0, high: 0 }

  if (facility === 'colo') {
    const rates = INFRA.regions[region]
    monthlyFacilityUsd = add(
      scale(fromRate(rates.colocationUsdPerKwMonth), peakKwTotal),
      scale(fromRate(rates.crossConnectUsdPerMonth), Math.max(1, racks)),
    )
    oneTimeFacilityUsd = scale(fromRate(rates.colocationSetupUsd), Math.max(1, racks))
    warnings.push('Electricity is assumed bundled into the colocation $/kW rate — see the ops line for the on-prem/cloud alternative.')
  } else if (facility === 'on-prem') {
    const rates = INFRA.regions[region]
    oneTimeFacilityUsd = scale(fromRate(rates.onPremBuildUsdPerKw), peakKwTotal)
    warnings.push(
      'On-prem assumes the building, floor loading and permitting already exist; only the ' +
        'power/cooling build-out for this fleet is costed.',
    )
  } else {
    oneTimeFacilityUsd = { low: 0, high: 0 }
    warnings.push('Cloud rental: no facility or chassis capex — the accelerator\'s hourly rate already covers it.')
  }

  if (overrides?.monthlyFacilityUsd !== undefined) monthlyFacilityUsd = point(overrides.monthlyFacilityUsd)
  if (overrides?.oneTimeFacilityUsd !== undefined) oneTimeFacilityUsd = point(overrides.oneTimeFacilityUsd)

  return {
    coolingClass,
    peakKwPerNode,
    peakKwTotal,
    racks,
    rackPowerCeilingKw,
    pue,
    fitsRackPower,
    monthlyFacilityUsd,
    oneTimeFacilityUsd,
    warnings,
  }
}
