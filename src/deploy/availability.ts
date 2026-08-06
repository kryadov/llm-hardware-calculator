/**
 * Redundancy and degradation — spec §4.
 *
 * The unit of failure is a REPLICA, not a card: at TP inside a node, every
 * card in a replica holds a shard of the same tensor, so one dead card takes
 * the whole replica down (spec §4.1). At one replica, there is no redundancy
 * to compute — the only way up is a second replica, i.e. doubling that
 * replica's GPU cost.
 *
 * The degradation check (`checkDegradation`) does not reimplement any
 * physics: it re-calls `solve()` from `core/solver.ts` with the surviving
 * fleet pinned, and reads the answer straight off the result. This is the
 * ONLY place in `src/deploy` that calls back into `core`.
 */
import { INFRA, PRICING } from '../data'
import { solve } from '../core/solver'
import type { AcceleratorSpec, Deployment, ModelSpec, Workload } from '../core/types'
import { chassisClassFor, chassisUnitCost } from './hardware'
import { fromRate, moneyPoint, scale, scaleM } from './range'
import type { AvailabilityEstimate, AvailabilityPolicy, MoneyRange, Range } from './types'

/** How many replicas are actually deployed for a given policy (spec §4.2). */
export function deployedReplicas(policy: AvailabilityPolicy, baselineReplicas: number): number {
  switch (policy) {
    case 'none':
      return baselineReplicas
    case 'n+1':
    case 'n+1-spare':
      return baselineReplicas + 1
    case 'dual-site':
      return baselineReplicas * 2
  }
}

/**
 * Spare cards to keep on the shelf so an in-flight RMA does not leave the
 * fleet short (spec §4.3): expected failures during the RMA window, rounded
 * up at each end of both input bands.
 */
export function sparesForFleet(totalGpus: number, failureRate: Range, rmaWeeks: Range): Range {
  if (totalGpus <= 0) return { low: 0, high: 0 }
  const low = Math.ceil(totalGpus * failureRate.low * (rmaWeeks.low / 52))
  const high = Math.ceil(totalGpus * failureRate.high * (rmaWeeks.high / 52))
  return { low: Math.min(low, high), high: Math.max(low, high) }
}

/**
 * Re-runs `solve()` with the fleet pinned to `survivingReplicas` and reads
 * whether the SLA still holds (spec §4.3). No new physics — this calls the
 * exact function Verify mode uses.
 */
export function checkDegradation(args: {
  model: ModelSpec
  workload: Workload
  chosen: Deployment
  deployedReplicaCount: number
}): { degradedCapacityFraction: number; holdsSla: boolean } {
  const { model, workload, chosen, deployedReplicaCount } = args
  const survivingReplicas = deployedReplicaCount - 1
  if (survivingReplicas < 1) return { degradedCapacityFraction: 0, holdsSla: false }

  const result = solve({
    model,
    workload,
    accelerators: [chosen.accelerator],
    costMode: 'off',
    pin: {
      acceleratorId: chosen.acceleratorId,
      totalGpus: chosen.parallelism.gpusPerReplica * survivingReplicas,
      quant: chosen.quant,
    },
  })

  if (result.deployments.length > 0) return { degradedCapacityFraction: 1, holdsSla: true }

  const miss = result.rejections.find(
    (r) => r.reason === 'slaTps' && r.actual !== undefined && r.required !== undefined,
  )
  if (miss && miss.required) {
    const fraction = (miss.actual as number) / (miss.required as number)
    return { degradedCapacityFraction: Math.max(0, Math.min(1, fraction)), holdsSla: false }
  }
  // Rejected for a reason other than a measurable SLA miss (e.g. no legal
  // split at that fleet size): treat conservatively as a full loss.
  return { degradedCapacityFraction: 0, holdsSla: false }
}

export function estimateAvailability(args: {
  model: ModelSpec
  workload: Workload
  chosen: Deployment
  accel: AcceleratorSpec
  policy: AvailabilityPolicy
}): AvailabilityEstimate {
  const { model, workload, chosen, accel, policy } = args
  const baselineReplicas = chosen.replicas
  const deployed = deployedReplicas(policy, baselineReplicas)
  const extraGpus = (deployed - baselineReplicas) * chosen.parallelism.gpusPerReplica

  const streetUsd = PRICING.gpus[accel.id]?.streetUsd ?? null
  const extraCardsUsd: MoneyRange = moneyPoint(streetUsd === null ? null : streetUsd * extraGpus)
  const gpusPerNode = chosen.totalGpus / chosen.totalNodes
  const extraNodes = Math.ceil(extraGpus / Math.max(1, gpusPerNode))
  const extraChassisUsd: MoneyRange = scaleM(chassisUnitCost(chassisClassFor(accel)), extraNodes)

  const warnings: string[] = []
  if (policy === 'none') {
    warnings.push(
      'No redundancy: this is a single replica. Losing one card takes the whole service down.',
    )
  }

  let sparesCount = 0
  let sparesUsd: MoneyRange = { low: 0, high: 0 }
  if (policy === 'n+1-spare') {
    const failureRate = INFRA.failureRates[accel.coefficientFamily]
    const rmaWeeks = INFRA.rmaWeeks.withSupportContract
    if (failureRate) {
      const spares = sparesForFleet(chosen.totalGpus + extraGpus, fromRate(failureRate.annualFailureRate), fromRate(rmaWeeks))
      sparesCount = Math.round((spares.low + spares.high) / 2)
      sparesUsd = streetUsd === null ? null : scale({ low: spares.low, high: spares.high }, streetUsd)
      if (accel.coefficientFamily === 'chinese-accelerator' || accel.coefficientFamily === 'consumer-pcie') {
        warnings.push(
          `Failure-rate figures for ${accel.displayName} are not vendor-disclosed; the spares count is a wide estimate.`,
        )
      }
    } else {
      warnings.push(`No failure-rate data for ${accel.coefficientFamily}; spares count defaults to 0.`)
    }
  }

  let degradedCapacityFraction: number | null = null
  let degradedHoldsSla: boolean | null = null
  if (policy !== 'dual-site') {
    const result = checkDegradation({ model, workload, chosen, deployedReplicaCount: deployed })
    degradedCapacityFraction = result.degradedCapacityFraction
    degradedHoldsSla = result.holdsSla
    if (!result.holdsSla) {
      warnings.push(
        `With one replica down, the fleet holds ~${Math.round(result.degradedCapacityFraction * 100)}% of the SLA target.`,
      )
    }
  }

  warnings.push(
    'This model treats failures as independent — it does not account for correlated outages ' +
      '(shared power, shared switch, human error). Real cluster incidents often are not independent.',
  )

  return {
    policy,
    baselineReplicas,
    deployedReplicas: deployed,
    extraGpus,
    extraCardsUsd,
    extraChassisUsd,
    sparesCount,
    sparesUsd,
    degradedCapacityFraction,
    degradedHoldsSla,
    warnings,
  }
}
