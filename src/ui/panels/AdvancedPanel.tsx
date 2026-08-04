/**
 * The "Advanced" disclosure — plan Task 14, spec §4 ("Прогрессивное раскрытие").
 *
 * Everything a load profile presets can be overridden here. Two rules make the
 * override honest:
 *
 * 1. An edited field is stored in `overrides`, never written back into the
 *    profile. The profile id survives, and the panel above merely relabels
 *    itself "Custom" (spec §4: «Правка любого поля переводит профиль в состояние
 *    "Custom" без тихой перезаписи»).
 * 2. Clearing a field deletes the override, so the control snaps back to the
 *    profile value instead of freezing at whatever was typed last.
 *
 * The panel is dumb: it is handed the *effective* workload (profile + overrides)
 * for display and the override bag for editing, and it emits the next override
 * bag. It never reads the catalogs.
 */
import type { ReactElement, ReactNode } from 'react'
import { useId, useState } from 'react'

import type { KvQuant, Workload } from '../../core/types'
import { useLang } from '../i18n'

/** Workload keys this panel can override — the spec's list, in display order. */
export type AdvancedKey =
  | 'promptTokens'
  | 'outputTokens'
  | 'peakFactor'
  | 'prefixCacheHitRate'
  | 'slaTokensPerSec'
  | 'slaTtftSeconds'
  | 'maxContext'
  | 'speculative'
  | 'gpuMemUtil'
  | 'kvQuant'

export const ADVANCED_KEYS: readonly AdvancedKey[] = [
  'promptTokens',
  'outputTokens',
  'peakFactor',
  'prefixCacheHitRate',
  'slaTokensPerSec',
  'slaTtftSeconds',
  'maxContext',
  'speculative',
  'gpuMemUtil',
  'kvQuant',
]

const KV_QUANTS: readonly KvQuant[] = ['fp16', 'fp8', 'int4']

export interface AdvancedPanelProps {
  /** Profile values with overrides already applied — what the fields display. */
  workload: Workload
  /** Only the fields the user actually overrode. */
  overrides: Partial<Workload>
  /** Emits the complete next override bag; a cleared field is simply absent. */
  onChange: (overrides: Partial<Workload>) => void
  /** Context ceiling of the selected model, used as the field's `max`. */
  maxContextLimit: number
  /** Controlled disclosure state. Omit to let the panel keep its own. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

const labelClass = 'block text-xs font-medium text-slate-700 dark:text-slate-300'
const hintClass = 'mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400'

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="mb-3">
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
      <p className={hintClass} id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  )
}

export function AdvancedPanel({
  workload,
  overrides,
  onChange,
  maxContextLimit,
  open,
  onOpenChange,
  className,
}: AdvancedPanelProps): ReactElement {
  const { t } = useLang()
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const uid = useId()
  const id = (key: string): string => `${uid}-${key}`

  const toggle = (): void => {
    const next = !isOpen
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  /** Set an override, or delete it when the field was cleared. */
  const set = <K extends AdvancedKey>(key: K, value: Workload[K] | undefined): void => {
    const next: Partial<Workload> = { ...overrides }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next)
  }

  const setNumber = (
    key: Exclude<AdvancedKey, 'speculative' | 'kvQuant'>,
    raw: string,
  ): void => {
    const trimmed = raw.trim()
    if (trimmed === '') return set(key, undefined)
    const n = Number(trimmed)
    if (!Number.isFinite(n)) return
    set(key, n)
  }

  const number = (
    key: Exclude<AdvancedKey, 'speculative' | 'kvQuant'>,
    attrs: { min?: number; max?: number; step?: number },
  ): ReactElement => (
    <input
      className={fieldClass}
      id={id(key)}
      aria-describedby={`${id(key)}-hint`}
      type="number"
      inputMode="decimal"
      min={attrs.min}
      max={attrs.max}
      step={attrs.step}
      value={String(workload[key])}
      onChange={(e) => setNumber(key, e.target.value)}
    />
  )

  return (
    <section className={className}>
      <h2>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-expanded={isOpen}
          aria-controls={id('fields')}
          onClick={toggle}
        >
          <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          {t.advanced.section}
        </button>
      </h2>

      {isOpen && (
        <div className="mt-2" id={id('fields')}>
          <p className={hintClass}>{t.advanced.hint}</p>

          <div className="mt-3">
            <Field
              id={id('promptTokens')}
              label={t.advanced.promptTokens.label}
              hint={t.advanced.promptTokens.hint}
            >
              {number('promptTokens', { min: 1, step: 100 })}
            </Field>

            <Field
              id={id('outputTokens')}
              label={t.advanced.outputTokens.label}
              hint={t.advanced.outputTokens.hint}
            >
              {number('outputTokens', { min: 1, step: 50 })}
            </Field>

            <Field
              id={id('peakFactor')}
              label={t.advanced.peakFactor.label}
              hint={t.advanced.peakFactor.hint}
            >
              {number('peakFactor', { min: 1, step: 0.1 })}
            </Field>

            <Field
              id={id('prefixCacheHitRate')}
              label={t.advanced.prefixCacheHitRate.label}
              hint={t.advanced.prefixCacheHitRate.hint}
            >
              {number('prefixCacheHitRate', { min: 0, max: 0.99, step: 0.05 })}
            </Field>

            <Field
              id={id('slaTokensPerSec')}
              label={t.advanced.slaTokensPerSec.label}
              hint={t.advanced.slaTokensPerSec.hint}
            >
              {number('slaTokensPerSec', { min: 0.1, step: 1 })}
            </Field>

            <Field
              id={id('slaTtftSeconds')}
              label={t.advanced.slaTtftSeconds.label}
              hint={t.advanced.slaTtftSeconds.hint}
            >
              {number('slaTtftSeconds', { min: 0.01, step: 0.1 })}
            </Field>

            <Field
              id={id('maxContext')}
              label={t.advanced.maxContext.label}
              hint={t.advanced.maxContext.hint}
            >
              {number('maxContext', { min: 128, max: maxContextLimit, step: 1024 })}
            </Field>

            <div className="mb-3">
              <div className="flex items-center gap-2">
                <input
                  className="size-4 rounded border-slate-300 accent-sky-600 dark:border-slate-600"
                  id={id('speculative')}
                  aria-describedby={`${id('speculative')}-hint`}
                  type="checkbox"
                  checked={workload.speculative}
                  onChange={(e) => set('speculative', e.target.checked)}
                />
                <label className={labelClass} htmlFor={id('speculative')}>
                  {t.advanced.speculative.label}
                </label>
              </div>
              <p className={hintClass} id={`${id('speculative')}-hint`}>
                {t.advanced.speculative.hint}
              </p>
            </div>

            <Field
              id={id('gpuMemUtil')}
              label={t.advanced.gpuMemUtil.label}
              hint={t.advanced.gpuMemUtil.hint}
            >
              {number('gpuMemUtil', { min: 0.05, max: 0.99, step: 0.01 })}
            </Field>

            <Field
              id={id('kvQuant')}
              label={t.advanced.kvQuant.label}
              hint={t.advanced.kvQuant.hint}
            >
              <select
                className={fieldClass}
                id={id('kvQuant')}
                aria-describedby={`${id('kvQuant')}-hint`}
                value={workload.kvQuant}
                onChange={(e) => set('kvQuant', e.target.value as KvQuant)}
              >
                {KV_QUANTS.map((q) => (
                  <option key={q} value={q}>
                    {t.enums.kvQuant[q]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      )}
    </section>
  )
}

export default AdvancedPanel
