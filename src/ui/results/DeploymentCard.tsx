/**
 * DeploymentCard — one candidate configuration.
 *
 * Spec §4 «Карточка деплоя». Collapsed: title, four key figures and the memory
 * bar. Expanded: parallelism and interconnect, the node around the
 * accelerators, the prefill-vs-decode utilization meter, the full cost
 * breakdown and the launch command with a copy button.
 *
 * Two rules run through the whole file.
 *
 * 1. EXACT vs MODELLED. Counts, memory sizes and price-list money are printed
 *    as points; anything the throughput model produced — per-user tok/s, TTFT,
 *    capacities, utilization, and every $/1M figure derived from them — is
 *    printed as the ±25% band. See `format.ts`.
 * 2. TWO PRICES, ONE HEADLINE. `usdPerMillionOutputTokens` is the figure that
 *    lines up with a published API price list, so it is the headline. The
 *    blended `usdPerMillionTokens` appears only in the expanded cost block,
 *    labelled and annotated as not API-comparable. It must never stand in for
 *    the headline: on a prompt-heavy profile it lands far below and flatters
 *    the configuration.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Deployment, ModelSpec, Warning } from '../../core/types'
import { fill, useLang } from '../i18n'
import type { Lang } from '../i18n'
import {
  EM_DASH,
  formatCount,
  formatPercent,
  formatPoint,
  formatRange,
  formatUsd,
} from './format'
import MemoryBar from './MemoryBar'

/* ------------------------------------------------------------------ */
/* Small formatting helpers that compose the shared primitives.        */
/* ------------------------------------------------------------------ */

/**
 * A money figure that inherits the throughput model's ±25%. The band itself
 * comes from `formatRange`, so the uncertainty constant lives in exactly one
 * place; only the currency sign is added here.
 */
function usdRange(value: number | null, lang: Lang): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH
  return `$${formatRange(value, '', lang)}`
}

/** A modelled fraction printed as a banded percentage: `31–52%`. */
function percentRange(value: number, lang: Lang): string {
  if (!Number.isFinite(value)) return EM_DASH
  return `${formatRange(value * 100, '', lang)}%`
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4

/**
 * Utilization meter geometry: what share of the *fleet* each phase consumes.
 *
 * `prefillLoad` and `decodeLoad` are measured against a SINGLE replica's
 * capacity and may exceed 1 — that is precisely why the solver provisioned
 * `replicas` of them. Dividing by the replica count turns them back into the
 * "fraction of the fleet the load actually consumes" the UI promises. Widths
 * sum to exactly 100 because headroom is the remainder.
 */
export function utilizationPercents(deployment: Deployment): {
  prefill: number
  decode: number
  headroom: number
} {
  const replicas = deployment.replicas > 0 ? deployment.replicas : 1
  const raw = (v: number): number => (Number.isFinite(v) && v > 0 ? v / replicas : 0)
  const p = raw(deployment.performance.prefillLoad)
  const d = raw(deployment.performance.decodeLoad)
  const denom = Math.max(1, p + d)
  const prefill = round4((p / denom) * 100)
  const decode = round4((d / denom) * 100)
  return { prefill, decode, headroom: Math.max(0, round4(100 - prefill - decode)) }
}

/* ------------------------------------------------------------------ */
/* Presentational pieces                                               */
/* ------------------------------------------------------------------ */

function Figure({
  name,
  label,
  value,
  note,
}: {
  name: string
  label: string
  value: string
  note?: string
}) {
  return (
    <div data-figure={name} title={note} className="min-w-0">
      <div className="truncate text-lg font-semibold text-[#0b0b0b] dark:text-white">
        {value}
      </div>
      <div className="truncate text-xs text-[#52514e] dark:text-[#c3c2b7]">{label}</div>
    </div>
  )
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-xs text-[#52514e] dark:text-[#c3c2b7]" title={note}>
        {label}
      </dt>
      <dd className="text-right text-xs font-medium tabular-nums text-[#0b0b0b] dark:text-white">
        {value}
      </dd>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#898781]">
        {title}
      </h4>
      <dl className="divide-y divide-black/5 dark:divide-white/5">{children}</dl>
    </section>
  )
}

/** Status marks ship as icon + label, never as colour alone (dataviz rule). */
function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-0.5 h-4 w-4 shrink-0 fill-[#b06a00] dark:fill-[#fab219]"
    >
      <path d="M8 1.5 15 14H1L8 1.5Zm0 4.2a.8.8 0 0 0-.8.85l.2 3.1a.6.6 0 0 0 1.2 0l.2-3.1A.8.8 0 0 0 8 5.7Zm0 5.3a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Z" />
    </svg>
  )
}

function WarningList({ warnings }: { warnings: readonly Warning[] }) {
  const { t } = useLang()
  if (warnings.length === 0) return null

  return (
    <ul className="mt-3 space-y-2">
      {warnings.map((w, i) => (
        <li
          key={`${w.kind}-${i}`}
          data-warning={w.kind}
          className="flex gap-2 rounded-lg border border-[#fab219]/60 bg-[#fab219]/10 px-3 py-2 text-xs leading-relaxed text-[#0b0b0b] dark:text-white"
        >
          <WarningIcon />
          <span>
            {fill(t.warning[w.kind], {
              miss: w.missPercent === undefined ? EM_DASH : formatPercent(w.missPercent),
            })}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */

export interface DeploymentCardProps {
  /** The candidate to render, straight out of `solve()`. */
  deployment: Deployment
  /** Used only for the `config.json` provenance link in the expanded card. */
  model?: ModelSpec
  /** Marks the card as the solver's top pick. */
  best?: boolean
  /** Start expanded — used by the shell for the first result and by tests. */
  defaultExpanded?: boolean
  className?: string
}

export default function DeploymentCard({
  deployment,
  model,
  best = false,
  defaultExpanded = false,
  className,
}: DeploymentCardProps) {
  const { t, lang } = useLang()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const { accelerator, parallelism: par, performance: perf, cost, memory } = deployment

  const nodesText = `${formatPoint(deployment.totalNodes, '')} ${
    deployment.totalNodes === 1 ? t.units.nodes : t.units.nodesPlural
  }`
  const parallelismText = [
    `TP=${par.tp}`,
    par.pp > 1 ? `PP=${par.pp}` : null,
    par.ep > 1 ? `EP=${par.ep}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  const util = utilizationPercents(deployment)
  const utilFleet = (v: number): number =>
    deployment.replicas > 0 ? v / deployment.replicas : v

  const hasMoney =
    cost.capex !== null ||
    cost.hourlyRent !== null ||
    cost.tco3y !== null ||
    cost.usdPerMillionOutputTokens !== null

  const copy = () => {
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    if (!write) {
      setCopyState('failed')
      return
    }
    write(deployment.launchCommand).then(
      () => setCopyState('copied'),
      () => setCopyState('failed'),
    )
  }

  const copyLabel =
    copyState === 'copied'
      ? t.actions.copied
      : copyState === 'failed'
        ? t.actions.copyFailed
        : t.actions.copy

  return (
    <article
      className={`rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19] ${
        className ?? ''
      }`}
    >
      {/* ---- Header ------------------------------------------------- */}
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {best ? (
          <span className="rounded-full bg-[#0ca30c]/15 px-2 py-0.5 text-[11px] font-semibold text-[#006300] dark:text-[#0ca30c]">
            {t.card.best}
          </span>
        ) : null}
        <h3 className="text-base font-semibold text-[#0b0b0b] dark:text-white">
          {fill(t.card.title, {
            gpus: formatPoint(deployment.totalGpus, ''),
            accelerator: accelerator.displayName,
          })}
        </h3>
        <p className="text-xs text-[#52514e] dark:text-[#c3c2b7]">
          {fill(t.card.subtitle, { nodes: nodesText, parallelism: parallelismText })}
        </p>
        <p className="text-xs text-[#898781]">
          {t.enums.quant[deployment.quant]} · {t.enums.framework[deployment.framework]}
        </p>
      </header>

      {/* ---- The four key figures ----------------------------------- */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure
          name="totalGpus"
          label={t.card.totalGpus}
          value={formatPoint(deployment.totalGpus, t.units.gpus)}
        />
        <Figure
          name="pricePerMOutput"
          label={t.card.pricePerMOutput}
          value={usdRange(cost.usdPerMillionOutputTokens, lang)}
          note={t.card.pricePerMOutputNote}
        />
        <Figure
          name="perUserTps"
          label={t.card.perUserTps}
          value={formatRange(perf.perUserTps, t.units.tokensPerSec, lang)}
        />
        <Figure
          name="ttft"
          label={t.card.ttft}
          value={formatRange(perf.ttft, t.units.seconds, lang)}
        />
      </div>

      <WarningList warnings={deployment.warnings} />

      <MemoryBar memory={memory} className="mt-4" />

      {/* ---- Disclosure --------------------------------------------- */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="mt-4 w-full rounded-lg border border-black/10 px-3 py-1.5 text-left text-xs font-medium text-[#52514e] hover:bg-black/[0.03] dark:border-white/10 dark:text-[#c3c2b7] dark:hover:bg-white/[0.05]"
      >
        {expanded ? t.card.collapse : t.card.expand}
      </button>

      {expanded ? (
        <div className="mt-4 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            {/* ---- Parallelism and interconnect --------------------- */}
            <Block title={t.card.parallelism}>
              <Row label={t.card.tp} value={formatPoint(par.tp, '')} />
              <Row label={t.card.pp} value={formatPoint(par.pp, '')} />
              <Row label={t.card.ep} value={formatPoint(par.ep, '')} />
              <Row
                label={t.card.gpusPerReplica}
                value={formatPoint(par.gpusPerReplica, t.units.gpus)}
              />
              <Row label={t.card.replicas} value={formatPoint(deployment.replicas, '')} />
              <Row label={t.card.totalNodes} value={nodesText} />
              <Row
                label={t.card.interconnect}
                value={
                  /*
                   * `requiredInterconnect` is null when no NETWORK fabric is
                   * needed — not when no interconnect is needed at all. A TP
                   * group of four cards in one chassis still rides the
                   * accelerator's own fabric, and saying otherwise would tell
                   * someone they could split those cards across machines.
                   */
                  par.requiredInterconnect !== null
                    ? t.enums.interconnect[par.requiredInterconnect]
                    : par.gpusPerReplica === 1
                      ? t.card.interconnectNone
                      : fill(t.card.interconnectIntraNode, {
                          fabric: t.enums.interconnect[deployment.accelerator.intraNode],
                        })
                }
              />
              {par.pp > 1 ? (
                <Row
                  label={t.card.bubblePenalty}
                  value={formatPercent(par.bubblePenalty)}
                />
              ) : null}
            </Block>

            {/* ---- The node around the accelerators ----------------- */}
            <Block title={t.card.hostTitle}>
              <Row
                label={t.card.hostRam}
                value={formatPoint(deployment.hostRamGib, t.units.gib)}
                note={t.card.hostRamHint}
              />
              <Row
                label={t.card.disk}
                value={formatPoint(deployment.diskGib, t.units.gib)}
                note={t.card.diskHint}
              />
              <Row
                label={t.card.maxConcurrentSeqs}
                value={formatCount(memory.maxConcurrentSeqs)}
              />
              <Row
                label={t.card.kvBytesPerToken}
                value={formatCount(memory.kvBytesPerToken)}
              />
              <Row
                label={t.card.kvReplication}
                value={formatPoint(memory.kvReplication, '')}
                note={t.card.kvReplicationHint}
              />
            </Block>
          </div>

          {/* ---- Prefill vs decode utilization meter ---------------- */}
          <section>
            <h4
              className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#898781]"
              title={t.card.utilizationHint}
            >
              {t.card.utilization}
            </h4>
            <div
              role="img"
              aria-label={`${t.card.prefillLoad} ${percentRange(
                utilFleet(perf.prefillLoad),
                lang,
              )} · ${t.card.decodeLoad} ${percentRange(utilFleet(perf.decodeLoad), lang)}`}
              className="flex h-2.5 w-full overflow-hidden rounded-[4px] bg-[#e1e0d9] dark:bg-[#383835]"
            >
              <div
                data-utilization="prefill"
                style={{ width: `${util.prefill}%` }}
                className="h-full bg-[#2a78d6] shadow-[inset_-2px_0_0_0_#fcfcfb] dark:bg-[#3987e5] dark:shadow-[inset_-2px_0_0_0_#1a1a19]"
              />
              <div
                data-utilization="decode"
                style={{ width: `${util.decode}%` }}
                className="h-full bg-[#eb6834] shadow-[inset_-2px_0_0_0_#fcfcfb] dark:bg-[#d95926] dark:shadow-[inset_-2px_0_0_0_#1a1a19]"
              />
              <div
                data-utilization="headroom"
                style={{ width: `${util.headroom}%` }}
                className="h-full bg-[#e1e0d9] dark:bg-[#383835]"
              />
            </div>
            <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
              <Row
                label={t.card.prefillLoad}
                value={percentRange(utilFleet(perf.prefillLoad), lang)}
              />
              <Row
                label={t.card.decodeLoad}
                value={percentRange(utilFleet(perf.decodeLoad), lang)}
              />
              <Row
                label={t.card.decodeCapacity}
                value={formatRange(perf.decodeCapacity, t.units.tokensPerSec, lang)}
              />
              <Row
                label={t.card.prefillCapacity}
                value={formatRange(perf.prefillCapacity, t.units.tokensPerSec, lang)}
              />
              <Row label={t.card.batch} value={formatRange(perf.batch, '', lang)} />
              <Row
                label={t.card.stepTime}
                value={formatRange(perf.stepTime, t.units.seconds, lang)}
              />
              <Row
                label={t.card.commFraction}
                value={percentRange(perf.commFraction, lang)}
              />
            </dl>
          </section>

          {/* ---- Cost ---------------------------------------------- */}
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#898781]">
              {t.card.costTitle}
            </h4>
            <dl className="divide-y divide-black/5 dark:divide-white/5">
              <Row label={t.card.capex} value={formatUsd(cost.capex)} note={t.card.capexHint} />
              <Row label={t.card.hourlyRent} value={formatUsd(cost.hourlyRent)} />
              <Row
                label={t.card.powerWatts}
                value={formatPoint(cost.powerWatts, t.units.watts)}
                note={t.card.powerHint}
              />
              <Row label={t.card.hourlyPower} value={formatUsd(cost.hourlyPower)} />
              <Row label={t.card.tco3y} value={formatUsd(cost.tco3y)} />
              <Row
                label={t.card.saturatedTokensPerSec}
                value={formatRange(cost.saturatedTokensPerSec, t.units.tokensPerSec, lang)}
                note={t.card.saturatedHint}
              />
            </dl>

            {/* The two token prices, side by side and impossible to confuse. */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div
                data-figure="pricePerMOutputDetail"
                className="rounded-lg border border-black/10 p-3 dark:border-white/10"
              >
                <div className="text-base font-semibold text-[#0b0b0b] dark:text-white">
                  {usdRange(cost.usdPerMillionOutputTokens, lang)}
                </div>
                <div className="text-xs font-medium text-[#52514e] dark:text-[#c3c2b7]">
                  {t.card.pricePerMOutput}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-[#898781]">
                  {t.card.pricePerMOutputNote}
                </p>
              </div>
              <div
                data-figure="pricePerMBlended"
                className="rounded-lg border border-dashed border-black/15 p-3 dark:border-white/15"
              >
                <div className="text-base font-semibold text-[#52514e] dark:text-[#c3c2b7]">
                  {usdRange(cost.usdPerMillionTokens, lang)}
                </div>
                <div className="text-xs font-medium text-[#52514e] dark:text-[#c3c2b7]">
                  {t.card.pricePerMBlended}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-[#898781]">
                  {t.card.pricePerMBlendedNote}
                </p>
              </div>
            </div>

            {hasMoney ? null : (
              <p className="mt-2 text-xs text-[#898781]">{t.card.costUnavailable}</p>
            )}
          </section>

          {/* ---- Launch command ------------------------------------ */}
          <section>
            <div className="mb-1 flex items-center justify-between gap-3">
              <h4
                className="text-xs font-semibold uppercase tracking-wide text-[#898781]"
                title={t.card.launchHint}
              >
                {t.card.launchTitle}
              </h4>
              <button
                type="button"
                onClick={copy}
                className="rounded-md border border-black/10 px-2 py-1 text-[11px] font-medium text-[#52514e] hover:bg-black/[0.03] dark:border-white/10 dark:text-[#c3c2b7] dark:hover:bg-white/[0.05]"
              >
                {copyLabel}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-black/[0.04] p-3 text-[11px] leading-relaxed text-[#0b0b0b] dark:bg-white/[0.06] dark:text-white">
              <code>{deployment.launchCommand}</code>
            </pre>
          </section>

          {/* ---- Provenance ---------------------------------------- */}
          {model || accelerator.note ? (
            <footer className="space-y-1 text-[11px] text-[#898781]">
              {model ? (
                <p>
                  <a
                    href={model.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2"
                  >
                    {t.card.modelSource}
                  </a>
                </p>
              ) : null}
              {accelerator.note ? (
                <p>
                  {t.card.acceleratorNote}: {accelerator.note}
                </p>
              ) : null}
            </footer>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
