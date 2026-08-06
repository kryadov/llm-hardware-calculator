/**
 * Domain types for the turnkey-deployment estimate — spec
 * `docs/superpowers/specs/2026-08-06-turnkey-deployment-design.md`.
 *
 * `src/deploy` depends on `src/core` and `src/data`, never the other way —
 * `purity.test.ts` enforces this. Nothing here is imported by `src/core`.
 */
import type { AcceleratorSpec, Deployment, ModelSpec, Workload } from '../core/types'

export type Facility = 'colo' | 'on-prem' | 'cloud'
export type Region = 'us' | 'eu' | 'ru' | 'apac'
export type AvailabilityPolicy = 'none' | 'n+1' | 'n+1-spare' | 'dual-site'
export type StaffingMode = 'business-hours' | 'extended' | '24x7'
export type SoftwarePreset = 'internal' | 'commercial' | 'regulated'
export type CoolingClass = 'air' | 'rear-door' | 'liquid'
export type SoftwareOptionKind = 'managed' | 'oss' | 'build'

/**
 * A `[low, high]` band. Every deploy-layer money and rate figure is one of
 * these rather than a point value, mirroring `UNCERTAINTY` in `core/types.ts`
 * extended to rates that have no vendor quote yet (spec §2.3).
 */
export interface Range {
  low: number
  high: number
}

/**
 * `null` means "cannot be priced" (spec §2.3) — propagates through sums rather
 * than silently becoming zero, the same discipline `CostBreakdown` uses for
 * `Usd | null` in `core/cost.ts`.
 */
export type MoneyRange = Range | null

/**
 * Point overrides keyed by a stable line-item id (see the `id` fields returned
 * by each module's warnings/line items). A present key collapses that item's
 * range to a single value — the user's own quote.
 */
export type RateOverrides = Partial<Record<string, number>>

export interface DeploymentInputs {
  facility: Facility
  region: Region
  availabilityPolicy: AvailabilityPolicy
  staffing: StaffingMode
  /** Amortization / planning horizon in years. Independent of core's fixed 3y TCO. */
  horizonYears: number
  softwarePreset: SoftwarePreset
  /** Per-component override of the preset's managed/oss/build choice, keyed by component id. */
  softwareOverrides?: Partial<Record<string, SoftwareOptionKind>>
  /** Overrides the cooling-class-derived rack power ceiling, in kW. */
  rackPowerCeilingKwOverride?: number
  /** Straight-line residual value at the end of the horizon; defaults to 0. */
  residualValueUsd?: Range
  overrides?: RateOverrides
}

export const DEFAULT_DEPLOYMENT_INPUTS: DeploymentInputs = {
  facility: 'colo',
  region: 'us',
  availabilityPolicy: 'none',
  staffing: 'business-hours',
  horizonYears: 3,
  softwarePreset: 'commercial',
}

export interface HardwareEstimate {
  chassisClassId: string | null
  cardsUsd: MoneyRange
  chassisUsd: MoneyRange
  networkingUsd: MoneyRange
  oneTimeMiscUsd: MoneyRange
  totalOneTimeUsd: MoneyRange
  warnings: string[]
}

export interface FacilityEstimate {
  coolingClass: CoolingClass
  peakKwPerNode: number
  peakKwTotal: number
  racks: number
  rackPowerCeilingKw: number
  pue: Range
  fitsRackPower: boolean
  monthlyFacilityUsd: MoneyRange
  oneTimeFacilityUsd: MoneyRange
  warnings: string[]
}

export interface AvailabilityEstimate {
  policy: AvailabilityPolicy
  baselineReplicas: number
  deployedReplicas: number
  extraGpus: number
  extraCardsUsd: MoneyRange
  extraChassisUsd: MoneyRange
  sparesCount: number
  sparesUsd: MoneyRange
  /** Fraction of the SLA target still met with one deployed replica down. `null` when not applicable (dual-site). */
  degradedCapacityFraction: number | null
  degradedHoldsSla: boolean | null
  warnings: string[]
}

export interface OpsEstimate {
  monthlyStaffingUsd: MoneyRange
  /** `null` when electricity is already bundled into the colo facility fee. */
  monthlyElectricityUsd: MoneyRange
  monthlySupportUsd: MoneyRange
  monthlyReplacementsUsd: MoneyRange
  monthlyTrafficUsd: MoneyRange
  avgKwTotal: number
  warnings: string[]
}

export interface SoftwareEstimate {
  selections: Record<string, SoftwareOptionKind>
  oneTimeSetupUsd: MoneyRange
  monthlyUsd: MoneyRange
  warnings: string[]
}

export type WaterfallStepId =
  | 'page1'
  | 'cards'
  | 'chassis-network'
  | 'facility'
  | 'redundancy'
  | 'staffing-support'
  | 'software'
  | 'traffic'

export interface WaterfallStep {
  id: WaterfallStepId
  /** English fallback label — the UI looks up `id` in its own dictionary instead. */
  label: string
  usdPerMillionTokens: number | null
}

export interface BreakevenResult {
  /** `null` when buy is never cheaper within the horizon, or facility is cloud-only. */
  breakevenMonths: number | null
  buyTco: MoneyRange
  rentTco: MoneyRange
}

export interface Risk {
  id: string
  severity: 'info' | 'warning' | 'blocking'
  detail: string
}

/**
 * The absolute money — what actually leaves the bank account.
 *
 * `$/1M tokens` answers "is this efficient"; these answer "how much do I need,
 * and when". Both are needed: the first Deploy page shipped only the per-token
 * delta, so a user in `costMode: 'buy'` came from a card reading $93,000 capex
 * and landed on a page whose largest number was $1.76.
 */
export interface DeploymentTotals {
  /** Everything paid before the service can serve: cards, chassis, fabric, facility build-out, spares, software setup. */
  oneTimeUsd: MoneyRange
  /** Everything paid every month: facility, electricity, support, replacements, staffing, software, traffic. */
  monthlyUsd: MoneyRange
  /** `oneTimeUsd + monthlyUsd × horizon`, less residual value. The number a budget is signed against. */
  horizonTcoUsd: MoneyRange
  horizonYears: number
}

export interface DeploymentEstimate {
  inputs: DeploymentInputs
  hardware: HardwareEstimate
  facility: FacilityEstimate
  availability: AvailabilityEstimate
  ops: OpsEstimate
  software: SoftwareEstimate
  totals: DeploymentTotals
  /** `Usd|null` from `chosen.cost`, relabeled as "page 1" for the delta headline. */
  page1UsdPerMillionTokens: number | null
  fullUsdPerMillionTokens: MoneyRange
  waterfall: WaterfallStep[]
  breakeven: BreakevenResult | null
  risks: Risk[]
  /** Same ids as `waterfall` (minus `page1`), in `$/1M tokens` — the UI looks the label up by `id`. */
  topLineItems: { id: Exclude<WaterfallStepId, 'page1'>; usdPerMillionTokens: MoneyRange }[]
  widestRanges: { id: Exclude<WaterfallStepId, 'page1'>; usdPerMillionTokens: MoneyRange }[]
}

/** Everything `estimate()` needs beyond the chosen deployment and the inputs. */
export interface EstimateContext {
  chosen: Deployment
  model: ModelSpec
  workload: Workload
  accel: AcceleratorSpec
  inputs: DeploymentInputs
}
