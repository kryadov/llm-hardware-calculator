/**
 * LoadSummary — the derived peak-load strip that sits above the results feed.
 *
 * Spec §4: «Пиковая нагрузка: 9.3 req/s · 112 сессий / Нужно: 7.4k tok/s декод
 * · 112k tok/s префилл».
 *
 * Every figure here is EXACT, so none of them is banded: `deriveLoad` is plain
 * arithmetic on the user's own assumptions (DAU × requests/day × peak factor,
 * then Little's law against the SLA they chose). The ±25% band belongs to the
 * throughput model, and the throughput model has not run yet at this point —
 * this strip is the demand, not a prediction about hardware.
 */
import type { DerivedLoad } from '../../core/types'
import { useLang } from '../i18n'
import { formatPoint } from './format'

export interface LoadSummaryProps {
  /** Peak traffic derived from the workload by `deriveLoad`. */
  derived: DerivedLoad
  className?: string
}

interface StatProps {
  name: string
  value: string
  label: string
  title?: string
}

function Stat({ name, value, label, title }: StatProps) {
  return (
    <div data-figure={name} title={title} className="min-w-0">
      <div className="truncate text-lg font-semibold text-[#0b0b0b] dark:text-white">
        {value}
      </div>
      <div className="truncate text-xs text-[#52514e] dark:text-[#c3c2b7]">{label}</div>
    </div>
  )
}

export default function LoadSummary({ derived, className }: LoadSummaryProps) {
  const { t } = useLang()

  return (
    <section
      aria-label={t.load.title}
      className={`rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19] ${
        className ?? ''
      }`}
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#898781]">
        {t.load.title}
      </h2>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat
          name="peakRps"
          value={formatPoint(derived.peakRps, '')}
          label={t.load.peakRps}
        />
        <Stat
          name="concurrentSeqs"
          value={formatPoint(derived.concurrentSeqs, '')}
          label={t.load.concurrentSeqs}
          title={t.load.concurrencyNote}
        />
        <Stat
          name="decodeNeeded"
          value={formatPoint(derived.decodeTokensPerSecNeeded, t.units.tokensPerSec)}
          label={`${t.load.needed} · ${t.load.decodeNeeded}`}
        />
        <Stat
          name="prefillNeeded"
          value={formatPoint(derived.prefillTokensPerSecNeeded, t.units.tokensPerSec)}
          label={`${t.load.needed} · ${t.load.prefillNeeded}`}
        />
      </div>

      <p className="mt-3 text-xs text-[#898781]">
        {t.load.avgSeqLen}: {formatPoint(derived.avgSeqLen, t.units.tokens)}
      </p>
    </section>
  )
}
