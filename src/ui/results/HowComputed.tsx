/**
 * HowComputed — spec §4 «Блок "Как это посчитано"».
 *
 * "Инженер не примет число без вывода; здесь он может проверить каждый шаг."
 *
 * Each step shows three things in the same order every time: the prose reason
 * the step exists, the symbolic formula from spec §3, and then every symbol in
 * that formula bound to THIS user's value. Reading top to bottom you can check
 * the arithmetic by hand — which is the point; a list of variable names with no
 * values attached would prove nothing.
 *
 * The values are read from the core's own output (`Deployment`, `DerivedLoad`)
 * or recomputed by calling the core's own exported functions. Nothing here
 * re-implements a formula: if this component and the solver ever disagreed, the
 * walkthrough would be a lie.
 */
import type { ReactNode } from 'react'

import type { Deployment, DerivedLoad, ModelSpec, Workload } from '../../core/types'
import { effectiveBitsPerWeight, weightBytes } from '../../core/memory'
import { GIB } from '../../core/units'
import { COEFFICIENTS, PRICING } from '../../data'
import type { CoefficientTable } from '../../data'
import { fill, useLang } from '../i18n'
import type { Lang } from '../i18n'
import {
  EM_DASH,
  formatCount,
  formatGib,
  formatPercent,
  formatPoint,
  formatRange,
  formatUsd,
} from './format'

/** A modelled fraction printed as a banded percentage: `31–52%`. */
function percentRange(value: number, lang: Lang): string {
  if (!Number.isFinite(value)) return EM_DASH
  return `${formatRange(value * 100, '', lang)}%`
}

function usdRange(value: number | null, lang: Lang): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH
  return `$${formatRange(value, '', lang)}`
}

/**
 * One bound symbol. `name` is the identifier as it appears in the formula
 * above it, so the eye can jump between the two without translation — which is
 * also why it is not run through the dictionary: `kvBytesPerTok` is code, not
 * copy.
 */
function Bind({ name, value, figure }: { name: string; value: string; figure?: string }) {
  return (
    <div
      data-figure={figure}
      className="flex items-baseline justify-between gap-4 border-b border-black/5 py-1 last:border-0 dark:border-white/5"
    >
      <dt className="font-mono text-[11px] text-[#52514e] dark:text-[#c3c2b7]">{name}</dt>
      <dd className="text-right text-xs font-medium tabular-nums text-[#0b0b0b] dark:text-white">
        {value}
      </dd>
    </div>
  )
}

function Step({
  title,
  body,
  formula,
  children,
}: {
  title: string
  body: string
  formula: string
  children?: ReactNode
}) {
  return (
    <section className="border-t border-black/10 pt-4 first:border-0 first:pt-0 dark:border-white/10">
      <h4 className="text-sm font-semibold text-[#0b0b0b] dark:text-white">{title}</h4>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-[#52514e] dark:text-[#c3c2b7]">
        {body}
      </p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-black/[0.04] p-3 font-mono text-[11px] leading-relaxed text-[#0b0b0b] dark:bg-white/[0.06] dark:text-white">
        <code>{formula}</code>
      </pre>
      {children ? <dl className="mt-2">{children}</dl> : null}
    </section>
  )
}

export interface HowComputedProps {
  model: ModelSpec
  workload: Workload
  /** Peak demand from `deriveLoad` — the input side of the utilization step. */
  derived: DerivedLoad
  /** The deployment being explained; normally the solver's top pick. */
  deployment: Deployment
  /** Defaults to the bundled coefficient table. */
  coefficients?: CoefficientTable
  /** Defaults to `pricing.json`'s own as-of date. */
  pricesAsOf?: string
  className?: string
}

export default function HowComputed({
  model,
  workload,
  derived,
  deployment,
  coefficients,
  pricesAsOf,
  className,
}: HowComputedProps) {
  const { t, lang } = useLang()
  const { accelerator, parallelism: par, performance: perf, cost, memory } = deployment
  const h = t.howComputed

  const table = coefficients ?? COEFFICIENTS
  const coeff = table.families[accelerator.coefficientFamily]
  const n = par.gpusPerReplica > 0 ? par.gpusPerReplica : 1

  return (
    <section
      className={`rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19] ${
        className ?? ''
      }`}
    >
      <h3 className="text-sm font-semibold text-[#0b0b0b] dark:text-white">{h.title}</h3>
      <p className="mt-1 text-xs text-[#898781]">{h.hint}</p>
      <p className="mb-4 mt-1 text-xs text-[#898781]">{h.accuracy}</p>

      <div className="space-y-4">
        <Step title={h.weights.title} body={h.weights.body} formula={h.weights.formula}>
          <Bind name="quant" value={t.enums.quant[deployment.quant]} />
          <Bind name="effBits" value={formatPoint(effectiveBitsPerWeight(deployment.quant), '')} />
          <Bind name="totalParams" value={formatCount(model.totalParams)} />
          <Bind name="activeParams" value={formatCount(model.activeParams)} />
          <Bind name="weightBytes" value={formatGib(weightBytes(model, deployment.quant))} />
          <Bind name="weightBytes / N" value={formatGib(memory.weightsPerGpu)} />
        </Step>

        <Step title={h.kvCache.title} body={h.kvCache.body} formula={h.kvCache.formula}>
          <Bind name="attention" value={t.enums.attention[model.attention.type]} />
          <Bind name="layers" value={formatPoint(model.layers, '')} />
          <Bind name="kvQuant" value={t.enums.kvQuant[workload.kvQuant]} />
          <Bind name="kvBytesPerTok" value={formatCount(memory.kvBytesPerToken)} />
          <Bind name="kvReplication" value={formatPoint(memory.kvReplication, '')} />
        </Step>

        <Step title={h.fit.title} body={h.fit.body} formula={h.fit.formula}>
          <Bind name="hbmPerGpu" value={formatGib(accelerator.memoryGib * GIB)} />
          <Bind name="gpuMemUtil" value={formatPercent(workload.gpuMemUtil)} />
          <Bind name="available" value={formatGib(memory.availablePerGpu)} />
          <Bind name="weights/N" value={formatGib(memory.weightsPerGpu)} />
          <Bind name="overhead" value={formatGib(memory.overheadPerGpu)} />
          <Bind name="N" value={formatPoint(par.gpusPerReplica, t.units.gpus)} />
          <Bind name="kvBudget" value={formatGib(memory.kvPerGpu * n)} />
          <Bind name="avgSeqLen" value={formatCount(derived.avgSeqLen)} />
          <Bind
            name="maxConcurrentSeqs"
            figure="maxConcurrentSeqs"
            value={formatCount(memory.maxConcurrentSeqs)}
          />
          <Bind name="concurrentSeqs (needed)" value={formatCount(derived.concurrentSeqs)} />
        </Step>

        <Step title={h.decode.title} body={h.decode.body} formula={h.decode.formula}>
          <Bind name="hbmBw" value={formatPoint(accelerator.memBandwidthGbs, t.units.gbPerSec)} />
          <Bind name="MBU" value={coeff ? formatPercent(coeff.mbu) : EM_DASH} />
          <Bind name="batch" value={formatRange(perf.batch, '', lang)} />
          <Bind name="stepTime" value={formatRange(perf.stepTime, t.units.seconds, lang)} />
          <Bind name="commTime / step" value={percentRange(perf.commFraction, lang)} />
          <Bind
            name="perUserTps"
            figure="perUserTps"
            value={formatRange(perf.perUserTps, t.units.tokensPerSec, lang)}
          />
          <Bind
            name="decodeCapacity"
            value={formatRange(perf.decodeCapacity, t.units.tokensPerSec, lang)}
          />
          <Bind name="slaTokensPerSec" value={formatPoint(workload.slaTokensPerSec, t.units.tokensPerSec)} />
        </Step>

        <Step title={h.prefill.title} body={h.prefill.body} formula={h.prefill.formula}>
          <Bind name="promptTok" value={formatCount(workload.promptTokens)} />
          <Bind name="prefixHitRate" value={formatPercent(workload.prefixCacheHitRate)} />
          <Bind name="MFU" value={coeff ? formatPercent(coeff.mfu) : EM_DASH} />
          <Bind
            name="prefillCapacity"
            value={formatRange(perf.prefillCapacity, t.units.tokensPerSec, lang)}
          />
          <Bind name="TTFT" value={formatRange(perf.ttft, t.units.seconds, lang)} />
          <Bind name="slaTtftSeconds" value={formatPoint(workload.slaTtftSeconds, t.units.seconds)} />
        </Step>

        <Step
          title={h.utilization.title}
          body={h.utilization.body}
          formula={h.utilization.formula}
        >
          <Bind name="RPS" value={formatPoint(derived.peakRps, t.units.requestsPerSec)} />
          <Bind name="outputTok" value={formatCount(workload.outputTokens)} />
          <Bind name="prefillLoad" value={percentRange(perf.prefillLoad, lang)} />
          <Bind name="decodeLoad" value={percentRange(perf.decodeLoad, lang)} />
          <Bind name="replicas" value={formatPoint(deployment.replicas, '')} />
          <Bind
            name="totalGpus"
            figure="totalGpus"
            value={formatPoint(deployment.totalGpus, t.units.gpus)}
          />
        </Step>

        <Step title={h.cost.title} body={h.cost.body} formula={h.cost.formula}>
          <Bind name="prefillNeeded" value={formatPoint(derived.prefillTokensPerSecNeeded, t.units.tokensPerSec)} />
          <Bind name="decodeNeeded" value={formatPoint(derived.decodeTokensPerSecNeeded, t.units.tokensPerSec)} />
          <Bind
            name="saturatedTokensPerSec"
            figure="saturatedTokensPerSec"
            value={formatRange(cost.saturatedTokensPerSec, t.units.tokensPerSec, lang)}
          />
          <Bind name="capex" value={formatUsd(cost.capex)} />
          <Bind name="hourlyRent" value={formatUsd(cost.hourlyRent)} />
          <Bind name="hourlyPower" value={formatUsd(cost.hourlyPower)} />
          <Bind name="tco3y" value={formatUsd(cost.tco3y)} />
          <Bind
            name="$/1M output"
            figure="pricePerMOutput"
            value={usdRange(cost.usdPerMillionOutputTokens, lang)}
          />
          <Bind
            name="$/1M blended"
            figure="pricePerMBlended"
            value={usdRange(cost.usdPerMillionTokens, lang)}
          />
        </Step>

        <Step
          title={h.coefficients.title}
          body={h.coefficients.body}
          formula={fill(h.coefficients.formula, {
            mbu: coeff ? formatPercent(coeff.mbu) : EM_DASH,
            mfu: coeff ? formatPercent(coeff.mfu) : EM_DASH,
            family: accelerator.coefficientFamily,
            framework: t.enums.framework[deployment.framework],
          })}
        >
          {coeff ? <Bind name="note" value={coeff.note} /> : null}
        </Step>

        <Step title={h.sources.title} body={h.sources.body} formula={h.sources.formula}>
          <div className="flex items-baseline justify-between gap-4 border-b border-black/5 py-1 dark:border-white/5">
            <dt className="font-mono text-[11px] text-[#52514e] dark:text-[#c3c2b7]">
              sourceUrl
            </dt>
            <dd className="text-right text-xs">
              <a
                href={model.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 text-[#0b0b0b] dark:text-white"
              >
                {t.card.modelSource}
              </a>
            </dd>
          </div>
          <Bind name="verifiedAt" value={model.verifiedAt} />
          <Bind name="pricesAsOf" value={pricesAsOf ?? PRICING.pricesAsOf} />
        </Step>
      </div>
    </section>
  )
}
