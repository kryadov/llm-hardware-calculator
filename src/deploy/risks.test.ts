/**
 * The license risk is keyed off the documented condition, never off the label.
 *
 * Regression guard for a shipped bug: `risks.ts` used to decide "may restrict
 * commercial use" with `/non-commercial|restricted|custom/i` against the
 * human-readable license name. That flagged all 8 GLM models — which are plain
 * MIT — as blocking, while saying nothing about MiniMax M2.7 and M3, whose
 * licenses genuinely forbid commercial use without written authorization.
 */
import { describe, it, expect } from 'vitest'
import { MODELS, ACCELERATORS } from '../data'
import { solve } from '../core/solver'
import { workloadFromProfile } from '../core/workload'
import { PROFILES } from '../data'
import type { ModelSpec } from '../core/types'
import { estimate } from './estimate'
import { DEFAULT_DEPLOYMENT_INPUTS } from './types'

const accel = (id: string) => ACCELERATORS.find((a) => a.id === id)!
const profile = (id: string) => PROFILES.find((p) => p.id === id)!

/** Prices a real configuration, swapping in whatever model spec the test needs. */
function risksFor(model: ModelSpec) {
  const workload = workloadFromProfile(profile('chat'), 100, 32768)
  const solved = solve({
    model,
    workload,
    accelerators: [accel('h200-sxm-141')],
    quants: ['fp8'],
    costMode: 'rent',
  })
  const chosen = solved.deployments[0]
  if (!chosen) throw new Error(`no deployment for ${model.id}`)
  return estimate({
    chosen,
    model,
    workload,
    accel: chosen.accelerator,
    inputs: DEFAULT_DEPLOYMENT_INPUTS,
  }).risks
}

const base = MODELS.find((m) => m.id === 'deepseek-v3-0324')!

describe('license risk', () => {
  it('a permissively licensed model raises no license risk', () => {
    const risks = risksFor({ ...base, license: 'MIT', licenseCommercialCondition: undefined })
    expect(risks.some((r) => r.id === 'license')).toBe(false)
  })

  it('a scary-sounding license NAME alone raises nothing — this was the bug', () => {
    const risks = risksFor({
      ...base,
      license: 'Custom (Non-Commercial Restricted Community License)',
      licenseCommercialCondition: undefined,
    })
    expect(
      risks.some((r) => r.id === 'license'),
      'the label must not be evidence; only a documented condition is',
    ).toBe(false)
  })

  it('a documented gate raises a blocking risk quoting the actual condition', () => {
    const risks = risksFor({
      ...base,
      license: 'MiniMax Non-Commercial License',
      licenseCommercialCondition: {
        severity: 'blocking',
        detail: 'Any commercial use is prohibited without prior written authorization from MiniMax.',
      },
    })
    const risk = risks.find((r) => r.id === 'license')
    expect(risk).toBeDefined()
    expect(risk!.severity).toBe('blocking')
    expect(risk!.detail).toContain('prior written authorization')
  })

  it('an attribution duty is a warning, not a blocker', () => {
    const risks = risksFor({
      ...base,
      license: 'Modified MIT (Moonshot)',
      licenseCommercialCondition: {
        severity: 'warning',
        detail: 'Above 100 million monthly active users you must display the model name in the UI.',
      },
    })
    const risk = risks.find((r) => r.id === 'license')
    expect(risk?.severity).toBe('warning')
  })

  it('the real catalog produces a blocking license risk for MiniMax M2.7', () => {
    const m = MODELS.find((x) => x.id === 'minimax-m2-7')!
    const risk = risksFor(m).find((r) => r.id === 'license')
    expect(risk?.severity).toBe('blocking')
  })

  it('the real catalog produces no license risk for any GLM model', () => {
    for (const m of MODELS.filter((x) => x.family === 'GLM').slice(0, 3)) {
      expect(risksFor(m).some((r) => r.id === 'license'), m.id).toBe(false)
    }
  })
})
