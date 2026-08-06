/**
 * Recurring operating cost — spec §6.
 *
 * Two corrections the naive `TDP × PUE` power figure misses (§6.1): billing
 * runs on AVERAGE draw, not the peak used to size racks in `facility.ts`, and
 * on colocation the electricity is usually already inside the $/kW fee, so
 * this module drops its own electricity line there rather than double-billing
 * it. Support, replacements and staffing are the categories a GPU-price
 * comparison never shows.
 */
import { INFRA, PRICING } from '../data'
import type { AcceleratorSpec } from '../core/types'
import { fromRate, point, scale, sumM } from './range'
import type { Facility, MoneyRange, OpsEstimate, RateOverrides, Region, StaffingMode } from './types'

/**
 * A fleet never idles down to zero: HBM refresh and clock floors keep even an
 * unloaded datacenter GPU well above zero draw. Average power is therefore
 * `max(peak/peakFactor, IDLE_POWER_FRACTION * peak)`, not simply `peak/peakFactor`.
 */
export const IDLE_POWER_FRACTION = 0.4

export const HOURS_PER_MONTH = 8760 / 12

export function estimateOps(args: {
  accel: AcceleratorSpec
  totalGpus: number
  cardsUsd: MoneyRange
  chassisUsd: MoneyRange
  networkingUsd: MoneyRange
  peakKwTotal: number
  peakFactor: number
  pue: { low: number; high: number }
  facility: Facility
  region: Region
  staffing: StaffingMode
  monthlyTrafficGb: number
  overrides?: RateOverrides
}): OpsEstimate {
  const {
    accel,
    totalGpus,
    cardsUsd,
    chassisUsd,
    networkingUsd,
    peakKwTotal,
    peakFactor,
    pue,
    facility,
    region,
    staffing,
    monthlyTrafficGb,
    overrides,
  } = args
  const warnings: string[] = []

  const avgKwIt = Math.max(peakKwTotal / Math.max(1, peakFactor), peakKwTotal * IDLE_POWER_FRACTION)
  const avgKwTotal = avgKwIt * ((pue.low + pue.high) / 2)

  // Zero, not null — "bundled into colo" / "inside the rented rate" is a
  // structural fact, not a missing price. See `facility.ts`'s note on why
  // that distinction matters for every total this field feeds into.
  let monthlyElectricityUsd: MoneyRange = { low: 0, high: 0 }
  if (facility === 'on-prem') {
    const rate = fromRate(INFRA.regions[region].electricityUsdPerKwh)
    monthlyElectricityUsd = scale(rate, avgKwTotal * HOURS_PER_MONTH)
  } else if (facility === 'colo') {
    warnings.push('Electricity is already inside the colocation facility fee (see facility line).')
  }
  // facility === 'cloud': no electricity line — it's inside the rented rate.

  const rates = INFRA.regions[region]
  const coverageFte = INFRA.staffingCoverageFte[staffing] ?? 1
  let monthlyStaffingUsd: MoneyRange = scale(fromRate(rates.staffUsdPerMonth), coverageFte)

  let monthlySupportUsd: MoneyRange = { low: 0, high: 0 }
  let monthlyReplacementsUsd: MoneyRange = { low: 0, high: 0 }
  if (facility !== 'cloud') {
    const support = INFRA.vendorSupport
    const serverCapex = sumM([cardsUsd, chassisUsd])
    monthlySupportUsd = sumM([
      serverCapex === null
        ? null
        : {
            low: (serverCapex.low * support.serverSupportPctOfCapexPerYear.low) / 12,
            high: (serverCapex.high * support.serverSupportPctOfCapexPerYear.high) / 12,
          },
      networkingUsd === null
        ? null
        : {
            low: (networkingUsd.low * support.fabricSupportPctOfCapexPerYear.low) / 12,
            high: (networkingUsd.high * support.fabricSupportPctOfCapexPerYear.high) / 12,
          },
      scale(fromRate(support.softwareSubscriptionUsdPerGpuPerYear), totalGpus / 12),
    ])

    const failureRate = INFRA.failureRates[accel.coefficientFamily]
    const streetUsd = PRICING.gpus[accel.id]?.streetUsd ?? null
    if (failureRate && streetUsd !== null) {
      const annualFailures = fromRate(failureRate.annualFailureRate)
      monthlyReplacementsUsd = {
        low: (totalGpus * annualFailures.low * streetUsd) / 12,
        high: (totalGpus * annualFailures.high * streetUsd) / 12,
      }
    } else if (!failureRate) {
      warnings.push(`No failure-rate data for ${accel.coefficientFamily}; replacement cost defaults to 0.`)
    } else {
      monthlyReplacementsUsd = null
      warnings.push(`No street price for ${accel.displayName}; replacement cost cannot be estimated.`)
    }
  }

  const trafficRate = fromRate(INFRA.trafficEgressUsdPerGb)
  const monthlyTrafficUsd = scale(trafficRate, monthlyTrafficGb)

  if (overrides?.monthlyStaffingUsd !== undefined) monthlyStaffingUsd = point(overrides.monthlyStaffingUsd)
  if (overrides?.monthlyElectricityUsd !== undefined) monthlyElectricityUsd = point(overrides.monthlyElectricityUsd)
  if (overrides?.monthlySupportUsd !== undefined) monthlySupportUsd = point(overrides.monthlySupportUsd)

  return {
    monthlyStaffingUsd,
    monthlyElectricityUsd,
    monthlySupportUsd,
    monthlyReplacementsUsd,
    monthlyTrafficUsd,
    avgKwTotal,
    warnings,
  }
}

