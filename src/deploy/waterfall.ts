/**
 * The delta headline — spec §8.1.
 *
 * Converts each cost category's hourly contribution into `$/1M tokens` at the
 * SAME token throughput used throughout (`chosen.cost.saturatedTokensPerSec`,
 * unscaled by redundancy — a spare replica is an insurance premium against
 * the load actually served, not extra capacity the price should be divided
 * across). Each step uses the midpoint of its range; the full-precision band
 * lives on `fullUsdPerMillionTokens`, not on the individual bars.
 */
import { mid } from './range'
import type { MoneyRange, WaterfallStep } from './types'

function stepValue(hourlyUsd: MoneyRange, tokensPerSec: number): number | null {
  if (hourlyUsd === null || !Number.isFinite(tokensPerSec) || tokensPerSec <= 0) return null
  return (mid(hourlyUsd) / (tokensPerSec * 3600)) * 1e6
}

export function buildWaterfall(args: {
  tokensPerSec: number
  page1UsdPerMillionTokens: number | null
  cardsHourlyUsd: MoneyRange
  chassisNetworkHourlyUsd: MoneyRange
  facilityHourlyUsd: MoneyRange
  redundancyHourlyUsd: MoneyRange
  staffingSupportHourlyUsd: MoneyRange
  softwareHourlyUsd: MoneyRange
  trafficHourlyUsd: MoneyRange
}): WaterfallStep[] {
  const { tokensPerSec } = args
  return [
    { id: 'page1', label: 'Page 1 estimate (cards + chassis + electricity)', usdPerMillionTokens: args.page1UsdPerMillionTokens },
    { id: 'cards', label: 'Cards (itemized)', usdPerMillionTokens: stepValue(args.cardsHourlyUsd, tokensPerSec) },
    { id: 'chassis-network', label: 'Chassis & networking', usdPerMillionTokens: stepValue(args.chassisNetworkHourlyUsd, tokensPerSec) },
    { id: 'facility', label: 'Racks, power & facility', usdPerMillionTokens: stepValue(args.facilityHourlyUsd, tokensPerSec) },
    { id: 'redundancy', label: 'Redundancy', usdPerMillionTokens: stepValue(args.redundancyHourlyUsd, tokensPerSec) },
    { id: 'staffing-support', label: 'Staffing, support & replacements', usdPerMillionTokens: stepValue(args.staffingSupportHourlyUsd, tokensPerSec) },
    { id: 'software', label: 'Software & services', usdPerMillionTokens: stepValue(args.softwareHourlyUsd, tokensPerSec) },
    { id: 'traffic', label: 'Traffic', usdPerMillionTokens: stepValue(args.trafficHourlyUsd, tokensPerSec) },
  ]
}
