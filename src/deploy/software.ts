/**
 * Software and services catalog costing — spec §7.
 *
 * Converts a preset (or per-component override) into a setup cost and a
 * recurring one. Setup weeks are priced through the SAME regional staffing
 * rate `ops.ts` uses for headcount, so "how many weeks to stand up billing"
 * and "what an engineer costs in this region" stay consistent with each
 * other instead of being two independently-guessed numbers.
 */
import { INFRA, SOFTWARE } from '../data'
import { fromRate, mid, point, sum } from './range'
import type {
  MoneyRange,
  Range,
  RateOverrides,
  Region,
  SoftwareEstimate,
  SoftwareOptionKind,
  SoftwarePreset,
} from './types'

const WEEKS_PER_MONTH = 52 / 12

export function estimateSoftware(args: {
  preset: SoftwarePreset
  region: Region
  selectionOverrides?: Partial<Record<string, SoftwareOptionKind>>
  overrides?: RateOverrides
}): SoftwareEstimate {
  const { preset, region, selectionOverrides, overrides } = args
  const presetMap = SOFTWARE.presets[preset] ?? {}
  const weeklyStaffRate = mid(fromRate(INFRA.regions[region].staffUsdPerMonth)) / WEEKS_PER_MONTH

  const selections: Record<string, SoftwareOptionKind> = {}
  const setupItems: Range[] = []
  const monthlyItems: Range[] = []
  const warnings: string[] = []

  for (const component of SOFTWARE.components) {
    const kind = selectionOverrides?.[component.id] ?? presetMap[component.id] ?? component.options[0].kind
    const option = component.options.find((o) => o.kind === kind) ?? component.options[0]
    selections[component.id] = option.kind

    setupItems.push({ low: option.setupWeeksLow * weeklyStaffRate, high: option.setupWeeksHigh * weeklyStaffRate })
    monthlyItems.push({ low: option.monthlyUsdLow, high: option.monthlyUsdHigh })
  }

  if (SOFTWARE.components.some((c) => c.prefixCacheSensitive)) {
    warnings.push(
      'The gateway/routing choice must preserve session affinity, or the prefix-cache hit rate ' +
        'modeled on page 1 will not materialize and the fleet will need to grow.',
    )
  }
  if (SOFTWARE.components.some((c) => c.meteringGranularitySensitive)) {
    warnings.push(
      'Metering must count prompt and output tokens separately — a single blended counter will ' +
        'misprice any workload whose mix differs from the one it was tuned on.',
    )
  }

  let oneTimeSetupUsd: MoneyRange = sum(setupItems)
  let monthlyUsd: MoneyRange = sum(monthlyItems)
  if (overrides?.softwareSetupUsd !== undefined) oneTimeSetupUsd = point(overrides.softwareSetupUsd)
  if (overrides?.softwareMonthlyUsd !== undefined) monthlyUsd = point(overrides.softwareMonthlyUsd)

  return { selections, oneTimeSetupUsd, monthlyUsd, warnings }
}
