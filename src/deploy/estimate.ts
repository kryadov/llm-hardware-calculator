/**
 * Orchestrator — spec §2.1, §8.
 *
 * `estimate()` is the one entry point `src/deploy` exposes. It takes the
 * `Deployment` the core solver already chose (whatever the user picked on
 * page 1) and a `DeploymentInputs` describing how it will actually be run,
 * and returns a full turnkey estimate.
 *
 * Deliberately NOT netted against `core/cost.ts`'s numbers: `chosen.cost`
 * bakes a flat `chassisUsd`/`ibSwitchUsdPerNode` constant into its capex,
 * and reverse-engineering an exact delta against that constant would make
 * this module fragile to any future change in `core/cost.ts`. Instead this
 * module prices the fleet bottom-up, independently, using the SAME GPU
 * street price — so the "cards" bar of the waterfall matches page 1's card
 * cost, and every bar after it is what page 1 did not count at all.
 *
 * Redundancy (spec §4) is priced by calling the hardware/facility/ops stack
 * TWICE — once at the baseline fleet size, once at the deployed (post-
 * redundancy) size — and taking the difference as the "redundancy" waterfall
 * step. Traffic is passed identically into both calls so it cancels out of
 * that delta (it does not scale with redundancy policy). The DEPLOYED call
 * is what's shown everywhere else in the estimate.
 */
import { PRICING } from '../data'
import { deriveLoad } from '../core/workload'
import { estimateAvailability } from './availability'
import { computeBreakeven } from './breakeven'
import { estimateFacility } from './facility'
import { estimateHardware } from './hardware'
import { estimateOps } from './ops'
import { addM, mid, point, scale, sumM, width, ZERO } from './range'
import { collectRisks } from './risks'
import { estimateSoftware } from './software'
import type {
  DeploymentEstimate,
  EstimateContext,
  FacilityEstimate,
  HardwareEstimate,
  MoneyRange,
  OpsEstimate,
  WaterfallStepId,
} from './types'
import { buildWaterfall } from './waterfall'

const HOURS_PER_MONTH = 8760 / 12
/** ~4 bytes/token (spec §5.6): a million tokens is roughly 4 MB either direction. */
const TRAFFIC_BYTES_PER_TOKEN = 4

/**
 * `null` here means "genuinely unpriced" and correctly poisons the sum via
 * `addM`. A component that structurally does not apply (hardware has no
 * monthly line, ops has no one-time line) must be passed as `ZERO`, never
 * `null` — passing `null` for "not applicable" would zero out the OTHER,
 * perfectly priced argument too. Every call site below follows that rule.
 */
function toHourly(oneTime: MoneyRange, monthly: MoneyRange, horizonHours: number): MoneyRange {
  const oneTimeHourly = oneTime === null ? null : scale(oneTime, 1 / horizonHours)
  const monthlyHourly = monthly === null ? null : scale(monthly, 1 / HOURS_PER_MONTH)
  return addM(oneTimeHourly, monthlyHourly)
}

interface Stack {
  hardware: HardwareEstimate
  facility: FacilityEstimate
  ops: OpsEstimate
  /** Cards + chassis + networking + one-time misc, amortized to hourly. */
  hardwareHourlyUsd: MoneyRange
  /** Facility capex + monthly fee, amortized to hourly. */
  facilityHourlyUsd: MoneyRange
  /** Electricity + support + replacements, monthly-only, amortized to hourly. */
  opsHourlyUsd: MoneyRange
  /** Staffing, amortized to hourly — tracked separately: it does not scale with fleet size. */
  staffingHourlyUsd: MoneyRange
  /** Traffic, amortized to hourly — tracked separately: it does not scale with fleet size. */
  trafficHourlyUsd: MoneyRange
  /** Cloud rental rate × GPUs, when `facility === 'cloud'`; `null` otherwise. */
  cloudRentalHourlyUsd: MoneyRange
}

function computeStack(args: {
  ctx: EstimateContext
  totalGpus: number
  totalNodes: number
  monthlyTrafficGb: number
  horizonHours: number
}): Stack {
  const { ctx, totalGpus, totalNodes, monthlyTrafficGb, horizonHours } = args
  const { accel, inputs, workload } = ctx

  const hardware = estimateHardware({
    accel,
    totalGpus,
    totalNodes,
    facility: inputs.facility,
    overrides: inputs.overrides,
  })
  const facility = estimateFacility({
    accel,
    totalGpus,
    totalNodes,
    facility: inputs.facility,
    region: inputs.region,
    rackPowerCeilingKwOverride: inputs.rackPowerCeilingKwOverride,
    overrides: inputs.overrides,
  })
  const ops = estimateOps({
    accel,
    totalGpus,
    cardsUsd: hardware.cardsUsd,
    chassisUsd: hardware.chassisUsd,
    networkingUsd: hardware.networkingUsd,
    peakKwTotal: facility.peakKwTotal,
    peakFactor: workload.peakFactor,
    pue: facility.pue,
    facility: inputs.facility,
    region: inputs.region,
    staffing: inputs.staffing,
    monthlyTrafficGb,
    overrides: inputs.overrides,
  })

  const hardwareHourlyUsd = toHourly(hardware.totalOneTimeUsd, ZERO, horizonHours)
  const facilityHourlyUsd = toHourly(facility.oneTimeFacilityUsd, facility.monthlyFacilityUsd, horizonHours)
  const opsHourlyUsd = toHourly(
    ZERO,
    sumM([ops.monthlyElectricityUsd, ops.monthlySupportUsd, ops.monthlyReplacementsUsd]),
    horizonHours,
  )
  const staffingHourlyUsd = toHourly(ZERO, ops.monthlyStaffingUsd, horizonHours)
  const trafficHourlyUsd = toHourly(ZERO, ops.monthlyTrafficUsd, horizonHours)

  let cloudRentalHourlyUsd: MoneyRange = null
  if (inputs.facility === 'cloud') {
    const rate = PRICING.gpus[accel.id]?.cloudUsdPerHour ?? null
    cloudRentalHourlyUsd = rate === null ? null : point(rate * totalGpus)
  }

  return {
    hardware,
    facility,
    ops,
    hardwareHourlyUsd,
    facilityHourlyUsd,
    opsHourlyUsd,
    staffingHourlyUsd,
    trafficHourlyUsd,
    cloudRentalHourlyUsd,
  }
}

export function estimate(ctx: EstimateContext): DeploymentEstimate {
  const { chosen, model, workload, accel, inputs } = ctx
  const horizonHours = Math.max(1, inputs.horizonYears) * 8760
  const horizonMonths = Math.max(1, inputs.horizonYears) * 12

  const availability = estimateAvailability({ model, workload, chosen, accel, policy: inputs.availabilityPolicy })

  const gpusPerNode = chosen.totalGpus / chosen.totalNodes
  const deployedTotalGpus = chosen.parallelism.gpusPerReplica * availability.deployedReplicas
  const deployedTotalNodes = Math.max(1, Math.round(deployedTotalGpus / gpusPerNode))

  const derived = deriveLoad(workload)
  const avgTokensPerSec =
    (derived.prefillTokensPerSecNeeded + derived.decodeTokensPerSecNeeded) / Math.max(1, workload.peakFactor)
  const monthlyTrafficGb = (avgTokensPerSec * 3600 * HOURS_PER_MONTH * TRAFFIC_BYTES_PER_TOKEN) / 1e9

  const deployed = computeStack({
    ctx,
    totalGpus: deployedTotalGpus,
    totalNodes: deployedTotalNodes,
    monthlyTrafficGb,
    horizonHours,
  })

  // Redundancy delta (spec §4): traffic is passed identically to both calls so it cancels out.
  let redundancyHourlyUsd: MoneyRange = { low: 0, high: 0 }
  if (availability.deployedReplicas !== availability.baselineReplicas) {
    const baseline = computeStack({
      ctx,
      totalGpus: chosen.totalGpus,
      totalNodes: chosen.totalNodes,
      monthlyTrafficGb,
      horizonHours,
    })
    const deployedTotal = sumM([deployed.hardwareHourlyUsd, deployed.facilityHourlyUsd, deployed.opsHourlyUsd])
    const baselineTotal = sumM([baseline.hardwareHourlyUsd, baseline.facilityHourlyUsd, baseline.opsHourlyUsd])
    redundancyHourlyUsd = deployedTotal === null || baselineTotal === null
      ? deployedTotal
      : { low: deployedTotal.low - baselineTotal.low, high: deployedTotal.high - baselineTotal.high }
  }

  // Spares (spec §4.3): extra cards on the shelf, unpowered, amortized like any other capex.
  const sparesHourlyUsd = toHourly(availability.sparesUsd, ZERO, horizonHours)

  const software = estimateSoftware({
    preset: inputs.softwarePreset,
    region: inputs.region,
    selectionOverrides: inputs.softwareOverrides,
    overrides: inputs.overrides,
  })
  const softwareHourlyUsd = toHourly(software.oneTimeSetupUsd, software.monthlyUsd, horizonHours)

  const cardsHourlyUsd = toHourly(deployed.hardware.cardsUsd, ZERO, horizonHours)
  const chassisNetworkHourlyUsd = toHourly(
    sumM([deployed.hardware.chassisUsd, deployed.hardware.networkingUsd, deployed.hardware.oneTimeMiscUsd]),
    ZERO,
    horizonHours,
  )
  const cardsBarHourlyUsd = inputs.facility === 'cloud' ? deployed.cloudRentalHourlyUsd : cardsHourlyUsd

  const totalHourlyUsd =
    inputs.facility === 'cloud'
      ? sumM([deployed.cloudRentalHourlyUsd, deployed.staffingHourlyUsd, softwareHourlyUsd, deployed.trafficHourlyUsd])
      : sumM([
          deployed.hardwareHourlyUsd,
          deployed.facilityHourlyUsd,
          deployed.opsHourlyUsd,
          sparesHourlyUsd,
          deployed.staffingHourlyUsd,
          softwareHourlyUsd,
          deployed.trafficHourlyUsd,
        ])

  const tokensPerSec = chosen.cost.saturatedTokensPerSec
  const fullUsdPerMillionTokens: MoneyRange =
    totalHourlyUsd === null || tokensPerSec <= 0 ? null : scale(totalHourlyUsd, 1e6 / (tokensPerSec * 3600))

  const page1UsdPerMillionTokens = chosen.cost.usdPerMillionTokens as number | null

  const waterfall = buildWaterfall({
    tokensPerSec,
    page1UsdPerMillionTokens,
    cardsHourlyUsd: cardsBarHourlyUsd,
    chassisNetworkHourlyUsd:
      inputs.facility === 'cloud' ? { low: 0, high: 0 } : sumM([chassisNetworkHourlyUsd, sparesHourlyUsd]),
    facilityHourlyUsd: inputs.facility === 'cloud' ? { low: 0, high: 0 } : deployed.facilityHourlyUsd,
    redundancyHourlyUsd,
    staffingSupportHourlyUsd: sumM([deployed.staffingHourlyUsd, deployed.opsHourlyUsd]),
    softwareHourlyUsd,
    trafficHourlyUsd: deployed.trafficHourlyUsd,
  })

  /* --- Absolute money -------------------------------------------------
   * The same two figures drive the headline totals and the buy-vs-rent
   * comparison, so they are computed once. In cloud mode nothing is bought:
   * the one-time side is a structural ZERO (not `null` — see `toHourly`) and
   * the rented hourly rate becomes a monthly line instead.
   */
  const cloudRate = PRICING.gpus[accel.id]?.cloudUsdPerHour ?? null
  const cloudRentalMonthly: MoneyRange =
    cloudRate === null ? null : point(cloudRate * deployedTotalGpus * HOURS_PER_MONTH)

  const oneTimeUsd: MoneyRange =
    inputs.facility === 'cloud'
      ? software.oneTimeSetupUsd
      : sumM([
          deployed.hardware.totalOneTimeUsd,
          deployed.facility.oneTimeFacilityUsd,
          availability.sparesUsd,
          software.oneTimeSetupUsd,
        ])

  const monthlyUsd: MoneyRange = sumM([
    inputs.facility === 'cloud' ? cloudRentalMonthly : deployed.facility.monthlyFacilityUsd,
    inputs.facility === 'cloud' ? ZERO : deployed.ops.monthlyElectricityUsd,
    inputs.facility === 'cloud' ? ZERO : deployed.ops.monthlySupportUsd,
    inputs.facility === 'cloud' ? ZERO : deployed.ops.monthlyReplacementsUsd,
    deployed.ops.monthlyStaffingUsd,
    software.monthlyUsd,
    deployed.ops.monthlyTrafficUsd,
  ])

  const residual = inputs.residualValueUsd ?? ZERO
  const horizonTcoUsd: MoneyRange =
    oneTimeUsd === null || monthlyUsd === null
      ? null
      : {
          low: oneTimeUsd.low + monthlyUsd.low * horizonMonths - residual.high,
          high: oneTimeUsd.high + monthlyUsd.high * horizonMonths - residual.low,
        }

  const totals = {
    oneTimeUsd,
    monthlyUsd,
    horizonTcoUsd,
    horizonYears: Math.max(1, inputs.horizonYears),
  }

  let breakeven = null
  if (inputs.facility !== 'cloud') {
    const rentMonthly: MoneyRange =
      cloudRentalMonthly === null
        ? null
        : sumM([
            cloudRentalMonthly,
            deployed.ops.monthlyStaffingUsd,
            software.monthlyUsd,
            deployed.ops.monthlyTrafficUsd,
          ])
    breakeven = computeBreakeven({
      buyOneTimeUsd: oneTimeUsd,
      buyMonthlyUsd: monthlyUsd,
      rentMonthlyUsd: rentMonthly,
      horizonMonths,
    })
  }

  const risks = collectRisks({
    hardware: deployed.hardware,
    facility: deployed.facility,
    availability,
    ops: deployed.ops,
    software,
    model,
    workload,
    accel,
    inputs,
  })

  const toPerMillion = (hourly: MoneyRange): MoneyRange =>
    hourly === null || tokensPerSec <= 0 ? null : scale(hourly, 1e6 / (tokensPerSec * 3600))

  const namedLines: { id: Exclude<WaterfallStepId, 'page1'>; usd: MoneyRange }[] = [
    { id: 'cards', usd: cardsBarHourlyUsd },
    { id: 'chassis-network', usd: chassisNetworkHourlyUsd },
    { id: 'facility', usd: deployed.facilityHourlyUsd },
    { id: 'redundancy', usd: redundancyHourlyUsd },
    {
      id: 'staffing-support',
      usd: sumM([deployed.staffingHourlyUsd, deployed.opsHourlyUsd]),
    },
    { id: 'software', usd: softwareHourlyUsd },
    { id: 'traffic', usd: deployed.trafficHourlyUsd },
  ]
  const priced = namedLines
    .map((l) => ({ id: l.id, usdPerMillionTokens: toPerMillion(l.usd) }))
    .filter((l): l is { id: typeof l.id; usdPerMillionTokens: NonNullable<MoneyRange> } => l.usdPerMillionTokens !== null)
  const topLineItems = [...priced].sort((a, b) => mid(b.usdPerMillionTokens) - mid(a.usdPerMillionTokens)).slice(0, 3)
  const widestRanges = [...priced].sort((a, b) => width(b.usdPerMillionTokens) - width(a.usdPerMillionTokens)).slice(0, 3)

  return {
    inputs,
    hardware: deployed.hardware,
    facility: deployed.facility,
    availability,
    ops: deployed.ops,
    software,
    totals,
    page1UsdPerMillionTokens,
    fullUsdPerMillionTokens,
    waterfall,
    breakeven,
    risks,
    topLineItems,
    widestRanges,
  }
}
