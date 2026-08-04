/**
 * The Verify tab's pinned-hardware block — plan Task 14, spec §4.
 *
 * Explore asks "what should I buy?" and searches the catalog; Verify asks "will
 * the fleet I already own hold?" and searches only the ways that fleet can be
 * split. So on this tab the vendor filter is meaningless and is replaced by the
 * three facts that pin the search: which accelerator, how many of them, and
 * which checkpoint is being served.
 *
 * Weight quantization moves in here rather than being duplicated: `FormState`
 * has a single `quant`, and showing two controls bound to it would let the user
 * watch one change while touching the other.
 */
import type { ReactElement } from 'react'
import { useId } from 'react'

import type { SolvePin } from '../../core/solver'
import type { Quant } from '../../core/types'
import { ACCELERATORS } from '../../data'
import { useLang } from '../i18n'
import type { FormState, Pin } from '../state'

const QUANTS: readonly Quant[] = ['bf16', 'fp8', 'int8', 'int4']

/**
 * What Verify assumes before the user has pinned anything: one full node of the
 * most common datacenter accelerator. Exported so the app shell can solve the
 * Verify tab on first render, when `state.pin` is still null.
 */
export const DEFAULT_PIN: Pin = {
  acceleratorId: ACCELERATORS.some((a) => a.id === 'h100-sxm-80')
    ? 'h100-sxm-80'
    : ACCELERATORS[0].id,
  totalGpus: 8,
}

/** The pin to display and solve with: the user's, or {@link DEFAULT_PIN}. */
export function resolvePin(pin: Pin | null): Pin {
  if (pin === null) return DEFAULT_PIN
  return ACCELERATORS.some((a) => a.id === pin.acceleratorId) ? pin : DEFAULT_PIN
}

/** The `pin` argument for `solve()`: the resolved fleet plus the chosen quant. */
export function solvePin(state: FormState): SolvePin {
  const pin = resolvePin(state.pin)
  return { acceleratorId: pin.acceleratorId, totalGpus: pin.totalGpus, quant: state.quant }
}

export interface VerifyPanelProps {
  state: FormState
  /** Same patch channel as the rest of the panel, so the shell wires one handler. */
  onChange: (patch: Partial<FormState>) => void
  className?: string
}

const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 ' +
  'shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

const labelClass = 'block text-xs font-medium text-slate-700 dark:text-slate-300'
const hintClass = 'mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400'
const sectionTitleClass =
  'text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300'

export function VerifyPanel({ state, onChange, className }: VerifyPanelProps): ReactElement {
  const { t } = useLang()
  const uid = useId()
  const id = (key: string): string => `${uid}-${key}`
  const pin = resolvePin(state.pin)

  const setPin = (patch: Partial<Pin>): void => {
    onChange({ pin: { ...pin, ...patch } })
  }

  return (
    <section className={className}>
      <h2 className={sectionTitleClass}>{t.input.verify.section}</h2>
      <p className={hintClass}>{t.input.verify.hint}</p>

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('accelerator')}>
          {t.input.verify.accelerator}
        </label>
        <select
          className={`${fieldClass} mt-1`}
          id={id('accelerator')}
          aria-describedby={id('accelerator-hint')}
          value={pin.acceleratorId}
          onChange={(e) => setPin({ acceleratorId: e.target.value })}
        >
          {ACCELERATORS.map((a) => (
            <option key={a.id} value={a.id}>
              {`${a.displayName} · ${a.memoryGib} ${t.units.gib}`}
            </option>
          ))}
        </select>
        <p className={hintClass} id={id('accelerator-hint')}>
          {t.input.verify.acceleratorHint}
        </p>
      </div>

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('totalGpus')}>
          {t.input.verify.totalGpus}
        </label>
        <input
          className={`${fieldClass} mt-1`}
          id={id('totalGpus')}
          aria-describedby={id('totalGpus-hint')}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={String(pin.totalGpus)}
          onChange={(e) => {
            const n = Number(e.target.value.trim())
            if (!Number.isFinite(n) || n < 1) return
            setPin({ totalGpus: Math.floor(n) })
          }}
        />
        <p className={hintClass} id={id('totalGpus-hint')}>
          {t.input.verify.totalGpusHint}
        </p>
      </div>

      <div className="mt-3">
        <label className={labelClass} htmlFor={id('quant')}>
          {t.input.verify.quant}
        </label>
        <select
          className={`${fieldClass} mt-1`}
          id={id('quant')}
          aria-describedby={id('quant-hint')}
          value={state.quant}
          onChange={(e) => onChange({ quant: e.target.value as Quant })}
        >
          {QUANTS.map((q) => (
            <option key={q} value={q}>
              {t.enums.quant[q]}
            </option>
          ))}
        </select>
        <p className={hintClass} id={id('quant-hint')}>
          {t.input.verify.quantHint}
        </p>
      </div>
    </section>
  )
}

export default VerifyPanel
