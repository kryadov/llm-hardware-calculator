/**
 * The Deploy tab's input block — spec §2.2, §3-§7 of the turnkey design.
 *
 * Explore and Verify ask "what should I buy?" and "will it hold?"; Deploy asks
 * "what does running this, for real, actually cost?" It does not re-pick the
 * model or the hardware — it prices whatever is pinned on Explore/Verify (the
 * same `state.pin` + `state.quant` Verify already uses), and asks only the
 * questions that decide the rest of the bill: where it runs, how it is
 * reserved, who operates it, and over what horizon.
 */
import type { ReactElement } from 'react'
import { useId } from 'react'

import type {
  AvailabilityPolicy,
  DeploymentInputs,
  Facility,
  Region,
  SoftwarePreset,
  StaffingMode,
} from '../../deploy'
import { ACCELERATORS, MODELS } from '../../data'
import { fill, useLang } from '../i18n'
import { resolvePin } from './VerifyPanel'
import type { FormState } from '../state'

const FACILITIES: readonly Facility[] = ['colo', 'on-prem', 'cloud']
const REGIONS: readonly Region[] = ['us', 'eu', 'ru', 'apac']
const AVAILABILITY_POLICIES: readonly AvailabilityPolicy[] = ['none', 'n+1', 'n+1-spare', 'dual-site']
const STAFFING_MODES: readonly StaffingMode[] = ['business-hours', 'extended', '24x7']
const SOFTWARE_PRESETS: readonly SoftwarePreset[] = ['internal', 'commercial', 'regulated']

const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const labelClass = 'block text-xs font-medium text-slate-700 dark:text-slate-300'
const hintClass = 'mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400'
const sectionTitleClass =
  'text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300'

export interface DeployPanelProps {
  state: FormState
  onChange: (patch: Partial<FormState>) => void
  className?: string
}

export function DeployPanel({ state, onChange, className }: DeployPanelProps): ReactElement {
  const { t } = useLang()
  const uid = useId()
  const id = (key: string): string => `${uid}-${key}`

  const pin = resolvePin(state.pin)
  const accel = ACCELERATORS.find((a) => a.id === pin.acceleratorId)
  const model = MODELS.find((m) => m.id === state.modelId)

  const setDeploy = (patch: Partial<DeploymentInputs>): void => {
    onChange({ deploy: { ...state.deploy, ...patch } })
  }

  return (
    <section className={className}>
      <h2 className={sectionTitleClass}>{t.deploy.panel.section}</h2>
      <p className={hintClass}>{t.deploy.panel.hint}</p>

      <div className="mt-3 rounded-md bg-slate-100 px-2 py-1.5 dark:bg-slate-800">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t.deploy.panel.pinnedTitle}
        </p>
        <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
          {fill(t.deploy.panel.pinnedSummary, {
            gpus: String(pin.totalGpus),
            accelerator: accel?.displayName ?? pin.acceleratorId,
            quant: t.enums.quant[state.quant],
          })}
          {model ? ` · ${model.displayName}` : ''}
        </p>
        <p className={hintClass}>{t.deploy.panel.pinnedChangeHint}</p>
      </div>

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('facility')}>
          {t.deploy.panel.facility}
        </label>
        <select
          className={`${fieldClass} mt-1`}
          id={id('facility')}
          aria-describedby={id('facility-hint')}
          value={state.deploy.facility}
          onChange={(e) => setDeploy({ facility: e.target.value as Facility })}
        >
          {FACILITIES.map((f) => (
            <option key={f} value={f}>
              {t.deploy.facility[f]}
            </option>
          ))}
        </select>
        <p className={hintClass} id={id('facility-hint')}>
          {t.deploy.panel.facilityHint}
        </p>
      </div>

      {state.deploy.facility !== 'cloud' ? (
        <div className="mt-3">
          <label className={labelClass} htmlFor={id('region')}>
            {t.deploy.panel.region}
          </label>
          <select
            className={`${fieldClass} mt-1`}
            id={id('region')}
            aria-describedby={id('region-hint')}
            value={state.deploy.region}
            onChange={(e) => setDeploy({ region: e.target.value as Region })}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {t.deploy.region[r]}
              </option>
            ))}
          </select>
          <p className={hintClass} id={id('region-hint')}>
            {t.deploy.panel.regionHint}
          </p>
        </div>
      ) : null}

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('availability')}>
          {t.deploy.panel.availabilityPolicy}
        </label>
        <select
          className={`${fieldClass} mt-1`}
          id={id('availability')}
          aria-describedby={id('availability-hint')}
          value={state.deploy.availabilityPolicy}
          onChange={(e) => setDeploy({ availabilityPolicy: e.target.value as AvailabilityPolicy })}
        >
          {AVAILABILITY_POLICIES.map((p) => (
            <option key={p} value={p}>
              {t.deploy.availabilityPolicy[p]}
            </option>
          ))}
        </select>
        <p className={hintClass} id={id('availability-hint')}>
          {t.deploy.panel.availabilityPolicyHint}
        </p>
      </div>

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('staffing')}>
          {t.deploy.panel.staffing}
        </label>
        <select
          className={`${fieldClass} mt-1`}
          id={id('staffing')}
          aria-describedby={id('staffing-hint')}
          value={state.deploy.staffing}
          onChange={(e) => setDeploy({ staffing: e.target.value as StaffingMode })}
        >
          {STAFFING_MODES.map((s) => (
            <option key={s} value={s}>
              {t.deploy.staffing[s]}
            </option>
          ))}
        </select>
        <p className={hintClass} id={id('staffing-hint')}>
          {t.deploy.panel.staffingHint}
        </p>
      </div>

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('horizon')}>
          {t.deploy.panel.horizonYears}
        </label>
        <input
          className={`${fieldClass} mt-1`}
          id={id('horizon')}
          aria-describedby={id('horizon-hint')}
          type="number"
          inputMode="numeric"
          min={1}
          max={15}
          step={1}
          value={String(state.deploy.horizonYears)}
          onChange={(e) => {
            const n = Number(e.target.value.trim())
            if (!Number.isFinite(n) || n < 1) return
            setDeploy({ horizonYears: Math.round(n) })
          }}
        />
        <p className={hintClass} id={id('horizon-hint')}>
          {t.deploy.panel.horizonYearsHint}
        </p>
      </div>

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('preset')}>
          {t.deploy.panel.softwarePreset}
        </label>
        <select
          className={`${fieldClass} mt-1`}
          id={id('preset')}
          aria-describedby={id('preset-hint')}
          value={state.deploy.softwarePreset}
          onChange={(e) => setDeploy({ softwarePreset: e.target.value as SoftwarePreset })}
        >
          {SOFTWARE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t.deploy.softwarePreset[p]}
            </option>
          ))}
        </select>
        <p className={hintClass} id={id('preset-hint')}>
          {t.deploy.panel.softwarePresetHint}
        </p>
      </div>
    </section>
  )
}

export default DeployPanel
