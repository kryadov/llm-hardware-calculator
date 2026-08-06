/**
 * Assumptions and risks — spec §8.4.
 *
 * Collected from what the user actually chose, not written as a static
 * disclaimer: every module already carries its own `warnings: string[]`
 * (spec's discipline of reasoning explained in place, same as
 * `core/solver.ts`'s `Rejection.detail`); this module folds those in and adds
 * the handful of cross-cutting checks no single module can see on its own —
 * license, rack power feasibility, and whether any rate has been replaced
 * with a real quote yet.
 */
import type {
  AvailabilityEstimate,
  DeploymentInputs,
  FacilityEstimate,
  HardwareEstimate,
  OpsEstimate,
  Risk,
  SoftwareEstimate,
} from './types'
import type { AcceleratorSpec, ModelSpec, Workload } from '../core/types'

export function collectRisks(args: {
  hardware: HardwareEstimate
  facility: FacilityEstimate
  availability: AvailabilityEstimate
  ops: OpsEstimate
  software: SoftwareEstimate
  model: ModelSpec
  workload: Workload
  accel: AcceleratorSpec
  inputs: DeploymentInputs
}): Risk[] {
  const { hardware, facility, availability, ops, software, model, workload, accel, inputs } = args
  const risks: Risk[] = []

  if (model.license && /non-commercial|restricted|custom/i.test(model.license)) {
    risks.push({
      id: 'license',
      severity: 'blocking',
      detail: `${model.displayName}'s license (${model.license}) may restrict commercial use — verify against ${model.sourceUrl} before delivering to a paying customer.`,
    })
  }

  if (!facility.fitsRackPower) {
    risks.push({
      id: 'rack-power',
      severity: 'blocking',
      detail: 'This configuration may not fit standard rack power limits even with liquid cooling — confirm with the facility before committing.',
    })
  }

  if (accel.note) {
    risks.push({ id: 'accel-note', severity: 'warning', detail: accel.note })
  }

  if (workload.prefixCacheHitRate > 0) {
    risks.push({
      id: 'prefix-cache-routing',
      severity: 'warning',
      detail:
        `Page 1 assumed a ${(workload.prefixCacheHitRate * 100).toFixed(0)}% prefix-cache hit ` +
        `rate. Without session-affinity routing that collapses toward zero and the fleet has to grow.`,
    })
  }

  const overrideCount = Object.keys(inputs.overrides ?? {}).length
  if (overrideCount === 0) {
    risks.push({
      id: 'default-rates',
      severity: 'info',
      detail: 'Every facility, staffing and support rate below is a catalog default, not a vendor quote. Replace the widest ranges first — see "What to confirm first".',
    })
  }

  for (const [source, list] of [
    ['hardware', hardware.warnings],
    ['facility', facility.warnings],
    ['availability', availability.warnings],
    ['ops', ops.warnings],
    ['software', software.warnings],
  ] as const) {
    for (const detail of list) {
      risks.push({ id: `${source}-${risks.length}`, severity: 'warning', detail })
    }
  }

  return risks
}
