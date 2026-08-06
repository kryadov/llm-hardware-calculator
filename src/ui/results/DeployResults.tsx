/**
 * The Deploy tab's output — spec §8 of the turnkey design.
 *
 * Leads with the delta (spec §8.1): what page 1 showed against the full
 * turnkey cost, because that number is the whole answer to "why is the
 * calculator's estimate not what I'll actually pay?" Everything else —
 * the waterfall, buy-vs-rent, what to confirm first, the risk list — explains
 * where that delta comes from and what to do about it.
 *
 * Risk and warning DETAIL text comes straight from `src/deploy` and is
 * English-only, same as `Rejection.detail` on the Explore tab (see
 * `RejectedTable.tsx`) — only the static chrome around it is translated.
 */
import type { ReactElement } from 'react'

import type { DeploymentEstimate, MoneyRange, Risk } from '../../deploy'
import { fill, useLang } from '../i18n'
import { EM_DASH, EN_DASH, formatCount, formatUsdPerMillion } from './format'

function formatMoneyRangePerMillion(r: MoneyRange): string {
  if (r === null) return EM_DASH
  if (r.low === r.high) return formatUsdPerMillion(r.low)
  return `${formatUsdPerMillion(r.low)}${EN_DASH}${formatUsdPerMillion(r.high)}`
}

const CARD = 'rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19]'
const HEADING = 'text-sm font-semibold text-[#0b0b0b] dark:text-white'
const BODY = 'text-xs leading-relaxed text-[#52514e] dark:text-[#c3c2b7]'
const MUTED = 'text-xs text-[#898781]'

const SEVERITY_TONE: Record<Risk['severity'], string> = {
  blocking: 'border-[#d13a3a]/40 bg-[#d13a3a]/10',
  warning: 'border-[#fab219]/60 bg-[#fab219]/10',
  info: 'border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]',
}

function RiskRow({ risk }: { risk: Risk }): ReactElement {
  const { t } = useLang()
  return (
    <li
      data-severity={risk.severity}
      className={`rounded-lg border px-3 py-2 text-xs leading-relaxed text-[#0b0b0b] dark:text-white ${SEVERITY_TONE[risk.severity]}`}
    >
      <span className="mr-2 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#52514e] dark:bg-white/10 dark:text-[#c3c2b7]">
        {t.deploy.severity[risk.severity]}
      </span>
      {risk.detail}
    </li>
  )
}

function LineRow({ item }: { item: { id: string; usdPerMillionTokens: MoneyRange } }): ReactElement {
  const { t } = useLang()
  const label = (t.deploy.waterfall as Record<string, string>)[item.id] ?? item.id
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-xs text-[#52514e] dark:text-[#c3c2b7]">{label}</dt>
      <dd className="text-right text-xs font-medium tabular-nums text-[#0b0b0b] dark:text-white">
        {formatMoneyRangePerMillion(item.usdPerMillionTokens)}
      </dd>
    </div>
  )
}

export interface DeployResultsProps {
  estimate: DeploymentEstimate
  className?: string
}

export function DeployResults({ estimate, className }: DeployResultsProps): ReactElement {
  const { t } = useLang()
  const e = estimate

  const severityRank: Record<Risk['severity'], number> = { blocking: 0, warning: 1, info: 2 }
  const sortedRisks = [...e.risks].sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

  return (
    <div className={`space-y-4 ${className ?? ''}`} data-testid="deploy-results">
      {/* ---- Delta headline ------------------------------------------ */}
      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <h2 className={HEADING}>{t.deploy.results.deltaTitle}</h2>
          <button
            type="button"
            onClick={() => window.print()}
            className="print:hidden rounded-md border border-black/10 px-2 py-1 text-[11px] font-medium text-[#52514e] hover:bg-black/[0.03] dark:border-white/10 dark:text-[#c3c2b7] dark:hover:bg-white/[0.05]"
          >
            {t.deploy.results.print}
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-dashed border-black/15 p-3 dark:border-white/15">
            <div className="text-lg font-semibold text-[#52514e] dark:text-[#c3c2b7]">
              {e.page1UsdPerMillionTokens === null ? EM_DASH : formatUsdPerMillion(e.page1UsdPerMillionTokens)}
            </div>
            <div className="text-xs font-medium text-[#52514e] dark:text-[#c3c2b7]">
              {t.deploy.results.page1Label} · {t.deploy.results.perMillionTokens}
            </div>
          </div>
          <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <div className="text-lg font-semibold text-[#0b0b0b] dark:text-white">
              {e.fullUsdPerMillionTokens === null
                ? t.deploy.results.priceUnavailable
                : formatMoneyRangePerMillion(e.fullUsdPerMillionTokens)}
            </div>
            <div className="text-xs font-medium text-[#52514e] dark:text-[#c3c2b7]">
              {t.deploy.results.fullLabel} · {t.deploy.results.perMillionTokens}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Waterfall -------------------------------------------------- */}
      <section className={CARD}>
        <h2 className={HEADING}>{t.deploy.results.waterfallTitle}</h2>
        <dl className="mt-2 divide-y divide-black/5 dark:divide-white/5">
          {e.waterfall.map((step) => (
            <div key={step.id} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="text-xs text-[#52514e] dark:text-[#c3c2b7]">{t.deploy.waterfall[step.id]}</dt>
              <dd className="text-right text-xs font-medium tabular-nums text-[#0b0b0b] dark:text-white">
                {step.usdPerMillionTokens === null ? EM_DASH : formatUsdPerMillion(step.usdPerMillionTokens)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---- Buy vs rent -------------------------------------------------- */}
      {e.breakeven ? (
        <section className={CARD}>
          <h2 className={HEADING}>{t.deploy.results.breakevenTitle}</h2>
          <p className={`mt-2 ${BODY}`}>
            {e.breakeven.breakevenMonths === null
              ? e.breakeven.buyTco === null
                ? t.deploy.results.breakevenUnavailable
                : t.deploy.results.breakevenNever
              : fill(t.deploy.results.breakevenMonths, {
                  months: formatCount(Math.round(e.breakeven.breakevenMonths)),
                })}
          </p>
        </section>
      ) : null}

      {/* ---- Top lines and widest ranges ---------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className={CARD}>
          <h3 className={HEADING}>{t.deploy.results.topLineTitle}</h3>
          <dl className="mt-2 divide-y divide-black/5 dark:divide-white/5">
            {e.topLineItems.map((item) => (
              <LineRow key={item.id} item={item} />
            ))}
          </dl>
        </section>
        <section className={CARD}>
          <h3 className={HEADING} title={t.deploy.results.widestRangeHint}>
            {t.deploy.results.widestRangeTitle}
          </h3>
          <dl className="mt-2 divide-y divide-black/5 dark:divide-white/5">
            {e.widestRanges.map((item) => (
              <LineRow key={item.id} item={item} />
            ))}
          </dl>
        </section>
      </div>

      {/* ---- Risks ---------------------------------------------------- */}
      <section className={CARD}>
        <h2 className={HEADING}>{t.deploy.results.risksTitle}</h2>
        {sortedRisks.length === 0 ? (
          <p className={`mt-2 ${MUTED}`}>{t.deploy.results.noRisks}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sortedRisks.map((risk, i) => (
              <RiskRow key={`${risk.id}-${i}`} risk={risk} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default DeployResults
