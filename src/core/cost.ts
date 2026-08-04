/**
 * Cost model — CAPEX, OPEX, electricity, TCO and `$/1M tokens`.
 *
 * Implements spec section 3.5 (Стоимость). This module knows nothing about the
 * throughput formulas: it consumes an already-computed `Performance` and a
 * `PricingTable`, and returns money. Prices live in `src/data/pricing.json`,
 * isolated behind `PricingTable` so the most perishable input never leaks into
 * the physics.
 *
 * Money is optional by construction. Many accelerators (Chinese parts in
 * particular) have no publishable street price and no cloud listing, so every
 * money field is `Usd | null` and is `null` — never `NaN` — whenever the
 * underlying price is missing or the arithmetic would be degenerate.
 */
import type { PricingTable } from '../data/schema'
import type {
  AcceleratorSpec,
  CostBreakdown,
  CostMode,
  DerivedLoad,
  Performance,
} from './types'
import { usd, watts } from './units'
import type { Usd } from './units'

/** Hours in a three-year amortization window (3 × 8760). Spec 3.5, `TCO3y`. */
export const HOURS_PER_3Y = 3 * 8760

/** Wraps a number as `Usd`, collapsing non-finite results to `null`. */
function money(n: number | null): Usd | null {
  if (n === null || !Number.isFinite(n)) return null
  return usd(n)
}

/**
 * Computes the full cost breakdown for one candidate deployment.
 *
 * `replicas` is required because `perf.prefillLoad` and `perf.decodeLoad` are
 * expressed against a SINGLE replica's capacity (spec 3.2).
 *
 * ```
 * capex   = streetUsd == null ? null
 *         : streetUsd * totalGpus + chassisUsd * totalNodes
 *           + (totalNodes > 1 ? ibSwitchUsdPerNode * totalNodes : 0)
 * powerWatts    = accel.tdpWatts * totalGpus * pricing.pue
 * hourlyPower   = powerWatts / 1000 * pricing.usdPerKwh
 * hourlyRent    = cloudUsdPerHour == null ? null : cloudUsdPerHour * totalGpus
 * utilization   = prefillLoad + decodeLoad
 * saturatedTokensPerSec = (prefillNeeded + decodeNeeded) * replicas / utilization
 * hourlyCost    = rent → hourlyRent | buy → capex / (3 * 8760) + hourlyPower | off → null
 * usdPerMillionTokens = hourlyCost / (saturatedTokensPerSec * 3600) * 1e6
 * tco3y         = capex + hourlyPower * 3 * 8760
 * ```
 *
 * Note what the token figure is NOT: `decodeCapacity + prefillCapacity`. Those
 * two capacities are each measured with the accelerator devoting itself
 * entirely to that phase, so adding them describes hardware doing prefill and
 * decode simultaneously at full rate — which is exactly what the utilization
 * model of spec 3.2 rules out. Summing them understated `$/1M tokens` by
 * roughly an order of magnitude. Instead the fleet is scaled up to saturation
 * along the workload's own prefill/decode mix: at utilization `u` a single
 * replica serves the whole demand while `u`-busy, so it saturates at
 * `demand / u`, and `replicas` of them at `demand * replicas / u`.
 *
 * In `off` mode every money field is `null` while `powerWatts` stays real: the
 * calculator must remain useful when the price file has gone stale (spec 3.6).
 */
export function computeCost(args: {
  accel: AcceleratorSpec
  totalGpus: number
  totalNodes: number
  /** Number of model replicas; `perf` loads are against one replica's capacity. */
  replicas: number
  perf: Performance
  /** The demand this deployment was sized for; sets the prefill/decode mix. */
  derived: DerivedLoad
  pricing: PricingTable
  mode: CostMode
}): CostBreakdown {
  const { accel, totalGpus, totalNodes, replicas, perf, derived, pricing, mode } = args
  const priced = mode !== 'off'
  const row = pricing.gpus[accel.id]

  /* --- Power: physics, not price. Always reported. ------------------ */
  const powerWattsValue = accel.tdpWatts * totalGpus * pricing.pue
  const powerWatts = watts(Number.isFinite(powerWattsValue) ? powerWattsValue : 0)
  const hourlyPower = priced ? money((powerWatts / 1000) * pricing.usdPerKwh) : null

  /* --- CAPEX -------------------------------------------------------- */
  const streetUsd = row?.streetUsd ?? null
  const capex =
    priced && streetUsd !== null
      ? money(
          streetUsd * totalGpus +
            pricing.chassisUsd * totalNodes +
            (totalNodes > 1 ? pricing.ibSwitchUsdPerNode * totalNodes : 0),
        )
      : null

  /* --- Rent --------------------------------------------------------- */
  const cloudUsdPerHour = row?.cloudUsdPerHour ?? null
  const hourlyRent =
    priced && cloudUsdPerHour !== null ? money(cloudUsdPerHour * totalGpus) : null

  /* --- TCO ---------------------------------------------------------- */
  const tco3y =
    capex === null || hourlyPower === null
      ? null
      : money(capex + hourlyPower * HOURS_PER_3Y)

  /* --- Throughput at saturation ------------------------------------- */
  const utilization = perf.prefillLoad + perf.decodeLoad
  const scale =
    Number.isFinite(utilization) && utilization > 0 ? replicas / utilization : 0

  const demandTokensPerSec =
    derived.prefillTokensPerSecNeeded + derived.decodeTokensPerSecNeeded
  const saturatedValue = demandTokensPerSec * scale
  const saturatedTokensPerSec = Number.isFinite(saturatedValue) ? saturatedValue : 0

  const saturatedOutputValue = derived.decodeTokensPerSecNeeded * scale
  const saturatedOutputTokensPerSec = Number.isFinite(saturatedOutputValue)
    ? saturatedOutputValue
    : 0

  /* --- $/1M tokens -------------------------------------------------- */
  let hourlyCost: Usd | null = null
  if (mode === 'rent') {
    hourlyCost = hourlyRent
  } else if (mode === 'buy') {
    hourlyCost = capex === null || hourlyPower === null
      ? null
      : money(capex / HOURS_PER_3Y + hourlyPower)
  }

  const perMillion = (tokensPerSecond: number): Usd | null =>
    hourlyCost === null || tokensPerSecond <= 0
      ? null
      : money((hourlyCost / (tokensPerSecond * 3600)) * 1e6)

  return {
    capex,
    hourlyRent,
    powerWatts,
    hourlyPower,
    tco3y,
    usdPerMillionTokens: perMillion(saturatedTokensPerSec),
    usdPerMillionOutputTokens: perMillion(saturatedOutputTokensPerSec),
    saturatedTokensPerSec,
  }
}
