/**
 * The sticky left-hand input column — plan Task 14, spec §4.
 *
 * Progressive disclosure: four controls carry the default view (model,
 * quantization, load profile, DAU), the profile expands into a strip of derived
 * numbers, and everything else hides behind "Advanced". The panel is fully
 * controlled — it renders `FormState` and emits patches — so the URL stays the
 * single source of truth (spec §4, "Состояние в URL").
 *
 * Every user-facing string comes from the dictionary; nothing here is written in
 * English by hand.
 */
import type { ReactElement } from 'react'
import { useId } from 'react'

import type { LoadProfile, ModelSpec, Quant, Vendor, Workload } from '../../core/types'
import { deriveLoad, workloadFromProfile } from '../../core/workload'
import { MODELS, PROFILES } from '../../data'
import { fill, useLang } from '../i18n'
import { formatCount, formatPoint } from '../results/format'
import { OVERRIDE_KEYS, VENDOR_ORDER } from '../state'
import type { FormState } from '../state'
import { AdvancedPanel } from './AdvancedPanel'
import { VerifyPanel } from './VerifyPanel'

const QUANTS: readonly Quant[] = ['bf16', 'fp8', 'int8', 'int4']
const COST_MODES = ['buy', 'rent', 'off'] as const

/** The selected model, falling back to the first catalog entry for an unknown id. */
export function selectedModel(state: FormState): ModelSpec {
  return MODELS.find((m) => m.id === state.modelId) ?? MODELS[0]
}

/** The selected load profile, falling back to the first catalog entry. */
export function selectedProfile(state: FormState): LoadProfile {
  return PROFILES.find((p) => p.id === state.profileId) ?? PROFILES[0]
}

/** True once any advanced field has been overridden — the "Custom" condition. */
export function isCustomProfile(overrides: Partial<Workload>): boolean {
  return Object.values(overrides).some((v) => v !== undefined)
}

/**
 * The workload `solve()` should run: the profile's presets, the model's native
 * context, then the user's overrides on top. The profile id is carried through
 * untouched, which is what lets the UI say "Custom" without losing track of
 * which profile the numbers started from.
 */
export function effectiveWorkload(state: FormState): Workload {
  const model = selectedModel(state)
  const base = workloadFromProfile(selectedProfile(state), state.dau, model.maxContext)
  const merged: Workload = { ...base }
  // Only the keys the URL is allowed to carry are applied, so a hand-edited
  // override bag cannot smuggle a second `profileId` or `dau` into the workload.
  for (const key of OVERRIDE_KEYS) {
    const value = state.overrides[key]
    if (value === undefined) continue
    Object.assign(merged, { [key]: value })
  }
  return merged
}

/** 671000000000 -> "671B", 3300000000 -> "3.3B". */
function formatParams(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  const [value, suffix] =
    n >= 1e12 ? [n / 1e12, 'T'] : n >= 1e9 ? [n / 1e9, 'B'] : n >= 1e6 ? [n / 1e6, 'M'] : [n, '']
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded}${suffix}`
}

/** 163840 -> "160k", 10240000 -> "10M". */
function formatContext(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))}M`
  if (n >= 1024) return `${Math.round(n / 1024)}k`
  return String(Math.round(n))
}

const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

const labelClass = 'block text-xs font-medium text-slate-700 dark:text-slate-300'
const hintClass = 'mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400'
const sectionClass = 'border-t border-slate-200 pt-4 dark:border-slate-800'
const sectionTitleClass =
  'text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300'
const segmentClass =
  // The radio itself is visually hidden but still focusable, so the segment
  // shows both the checked state and the focus ring of its peer input.
  'block cursor-pointer rounded-md px-2 py-1 text-center text-xs font-medium text-slate-600 ' +
  'hover:bg-slate-200 peer-checked:bg-sky-600 peer-checked:text-white ' +
  'peer-focus-visible:ring-2 peer-focus-visible:ring-sky-500 ' +
  'dark:text-slate-300 dark:hover:bg-slate-700 dark:peer-checked:bg-sky-500'

export interface InputPanelProps {
  state: FormState
  /** Emits only the fields that changed; the owner merges them into state. */
  onChange: (patch: Partial<FormState>) => void
  className?: string
}

export function InputPanel({ state, onChange, className }: InputPanelProps): ReactElement {
  const { t } = useLang()
  const uid = useId()
  const id = (key: string): string => `${uid}-${key}`

  const model = selectedModel(state)
  const workload = effectiveWorkload(state)
  const derived = deriveLoad(workload)
  const custom = isCustomProfile(state.overrides)
  const isVerify = state.tab === 'verify'

  const families: string[] = []
  for (const m of MODELS) if (!families.includes(m.family)) families.push(m.family)

  const modelOptionLabel = (m: ModelSpec): string => {
    const kind = m.moe === null ? t.input.model.badgeDense : t.input.model.badgeMoe
    const params =
      m.moe === null
        ? `${formatParams(m.totalParams)} ${kind}`
        : `${formatParams(m.totalParams)} ${kind} · ${formatParams(m.activeParams)}`
    return `${m.displayName} · ${params} · ${t.enums.attention[m.attention.type]}`
  }

  const toggleVendor = (vendor: Vendor): void => {
    const next = state.vendors.includes(vendor)
      ? state.vendors.filter((v) => v !== vendor)
      : [...state.vendors, vendor]
    onChange({ vendors: VENDOR_ORDER.filter((v) => next.includes(v)) })
  }

  return (
    <aside
      className={
        className ??
        'w-full shrink-0 space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[380px] lg:overflow-y-auto lg:pr-2'
      }
    >
      {/* Model */}
      <section>
        <h2 className={sectionTitleClass}>{t.input.model.section}</h2>
        <div className="mt-2">
          <label className={labelClass} htmlFor={id('model')}>
            {t.input.model.label}
          </label>
          <select
            className={`${fieldClass} mt-1`}
            id={id('model')}
            aria-describedby={id('model-hint')}
            value={model.id}
            onChange={(e) => onChange({ modelId: e.target.value })}
          >
            {families.map((family) => (
              <optgroup key={family} label={family}>
                {MODELS.filter((m) => m.family === family).map((m) => (
                  <option key={m.id} value={m.id}>
                    {modelOptionLabel(m)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className={hintClass} id={id('model-hint')}>
            {t.input.model.hint}
          </p>
        </div>

        <dl
          className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400"
          data-testid="model-badges"
        >
          <dt>{t.input.model.totalParams}</dt>
          <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
            {`${formatParams(model.totalParams)} ${
              model.moe === null ? t.input.model.badgeDense : t.input.model.badgeMoe
            }`}
          </dd>
          <dt>{t.input.model.activeParams}</dt>
          <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
            {formatParams(model.activeParams)}
          </dd>
          <dt>{t.input.model.attention}</dt>
          <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
            {t.enums.attention[model.attention.type]}
          </dd>
          <dt>{t.input.model.maxContextNative}</dt>
          <dd className="text-right font-medium text-slate-900 dark:text-slate-100">
            {formatContext(model.maxContext)}
          </dd>
        </dl>
      </section>

      {/* Weight quantization — on the Verify tab this control lives in VerifyPanel. */}
      {!isVerify && (
        <section className={sectionClass}>
          <fieldset>
            <legend className={sectionTitleClass}>{t.input.quant.section}</legend>
            <p className={`${labelClass} mt-2`} id={id('quant-label')}>
              {t.input.quant.label}
            </p>
            <div
              className="mt-1 grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
            >
              {QUANTS.map((q) => (
                <div key={q}>
                  <input
                    className="peer sr-only"
                    id={id(`quant-${q}`)}
                    type="radio"
                    name={id('quant')}
                    value={q}
                    checked={state.quant === q}
                    onChange={() => onChange({ quant: q })}
                  />
                  <label className={segmentClass} htmlFor={id(`quant-${q}`)}>
                    {t.enums.quant[q]}
                  </label>
                </div>
              ))}
            </div>
            <p className={hintClass}>{t.input.quant.hint}</p>
          </fieldset>
        </section>
      )}

      {/* Load: profile, DAU and the derived strip */}
      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>{t.input.profile.section}</h2>

        <div className="mt-2">
          <div className="flex items-baseline justify-between gap-2">
            <label className={labelClass} htmlFor={id('profile')}>
              {t.input.profile.label}
            </label>
            {custom && (
              <span
                className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
                title={t.input.profile.customBadge}
                data-testid="profile-custom"
              >
                {t.input.profile.custom}
              </span>
            )}
          </div>
          <select
            className={`${fieldClass} mt-1`}
            id={id('profile')}
            aria-describedby={id('profile-hint')}
            value={state.profileId}
            onChange={(e) => onChange({ profileId: e.target.value })}
          >
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {t.enums.profile[p.id as keyof typeof t.enums.profile] ?? p.id}
              </option>
            ))}
          </select>
          <p className={hintClass} id={id('profile-hint')}>
            {t.input.profile.hint}
          </p>
        </div>

        <div className="mt-3">
          <label className={labelClass} htmlFor={id('dau')}>
            {t.input.dau.label}
          </label>
          <input
            className={`${fieldClass} mt-1`}
            id={id('dau')}
            aria-describedby={id('dau-hint')}
            type="number"
            inputMode="numeric"
            min={1}
            step={100}
            value={String(state.dau)}
            onChange={(e) => {
              const n = Number(e.target.value.trim())
              if (!Number.isFinite(n) || n < 1) return
              onChange({ dau: Math.round(n) })
            }}
          />
          <p className={hintClass} id={id('dau-hint')}>
            {t.input.dau.hint}
          </p>
        </div>

        <p
          className="mt-3 rounded-md bg-slate-100 px-2 py-1.5 text-[11px] leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300"
          data-testid="derived-load"
        >
          {fill(t.input.profile.derived, {
            requests: formatCount(workload.requestsPerUserPerDay),
            prompt: formatCount(workload.promptTokens),
            output: formatCount(workload.outputTokens),
            peak: workload.peakFactor,
          })}
          {' · '}
          {formatPoint(derived.peakRps, t.units.requestsPerSec)}
          {' · '}
          {`${formatCount(derived.concurrentSeqs)} ${t.load.concurrentSeqs}`}
        </p>
      </section>

      {/* Advanced */}
      <section className={sectionClass}>
        <AdvancedPanel
          workload={workload}
          overrides={state.overrides}
          maxContextLimit={model.maxContext}
          onChange={(overrides) => onChange({ overrides })}
        />
      </section>

      {/* Hardware: the vendor filter, or the pinned fleet on the Verify tab */}
      <section className={sectionClass}>
        {isVerify ? (
          <VerifyPanel state={state} onChange={onChange} />
        ) : (
          <fieldset>
            <legend className={sectionTitleClass}>{t.input.vendors.section}</legend>
            <p className={`${labelClass} mt-2`}>{t.input.vendors.label}</p>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {VENDOR_ORDER.map((vendor) => (
                <div key={vendor} className="flex items-center gap-2">
                  <input
                    className="size-4 rounded border-slate-300 accent-sky-600 dark:border-slate-600"
                    id={id(`vendor-${vendor}`)}
                    type="checkbox"
                    checked={state.vendors.includes(vendor)}
                    onChange={() => toggleVendor(vendor)}
                  />
                  <label className="text-xs text-slate-700 dark:text-slate-300" htmlFor={id(`vendor-${vendor}`)}>
                    {t.enums.vendor[vendor]}
                  </label>
                </div>
              ))}
            </div>
            <p className={hintClass}>{t.input.vendors.hint}</p>
            {state.vendors.includes('cpu-apple') && (
              <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                {t.input.vendors.cpuAppleHint}
              </p>
            )}
          </fieldset>
        )}
      </section>

      {/* Cost mode */}
      <section className={sectionClass}>
        <fieldset>
          <legend className={sectionTitleClass}>{t.input.costMode.section}</legend>
          <p className={`${labelClass} mt-2`}>{t.input.costMode.label}</p>
          <div className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {COST_MODES.map((mode) => (
              <div key={mode}>
                <input
                  className="peer sr-only"
                  id={id(`cost-${mode}`)}
                  type="radio"
                  name={id('cost')}
                  value={mode}
                  checked={state.costMode === mode}
                  onChange={() => onChange({ costMode: mode })}
                />
                <label
                  className={segmentClass}
                  htmlFor={id(`cost-${mode}`)}
                  title={t.enums.costModeHint[mode]}
                >
                  {t.enums.costMode[mode]}
                </label>
              </div>
            ))}
          </div>
          <p className={hintClass}>{t.input.costMode.hint}</p>
        </fieldset>
      </section>
    </aside>
  )
}

export default InputPanel
