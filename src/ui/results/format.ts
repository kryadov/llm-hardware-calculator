import { UNCERTAINTY } from '../../core/types'
import { GIB } from '../../core/units'

/**
 * Language tag understood by the formatters.
 *
 * Structurally identical to the `Lang` union exported by the i18n module and
 * assignable to and from it. It is redeclared here so that this file — which
 * every results component imports — has no dependency on the dictionaries.
 */
export type Lang = 'en' | 'ru'

/** U+2013. Separates the two ends of an uncertainty band. Never a hyphen. */
export const EN_DASH = '–'
/** U+2014. The single rendering for "there is no number here". */
export const EM_DASH = '—'

const LOCALES: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU' }

const localeFor = (lang: Lang): string => LOCALES[lang] ?? LOCALES.en

/** Everything that is not a finite number renders as an em dash — never "NaN". */
const isFinal = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Decimal places for a value of this magnitude:
 * nothing below the ones place at or above 10, one decimal from 1 to 10, and
 * two significant digits below 1 (so 0.004 keeps its digits instead of
 * collapsing to "0.00").
 */
const decimalsFor = (v: number): number => {
  const a = Math.abs(v)
  if (a === 0) return 0
  if (a >= 10) return 0
  if (a >= 1) return 1
  return Math.min(8, 1 - Math.floor(Math.log10(a)))
}

/** Kill the float dust that makes 7.2 * 0.75 * 10 land on 54.000000000000004. */
const snap = (x: number): number => {
  const r = Math.round(x)
  return Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x)) ? r : x
}

const fixed = (v: number, decimals: number, lang: Lang): string =>
  new Intl.NumberFormat(localeFor(lang), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v)

const withUnit = (text: string, unit: string): string => (unit ? `${text} ${unit}` : text)

/**
 * Model-derived quantity rendered as the spec's mandatory +/-25% band
 * (`UNCERTAINTY` in src/core/types), e.g. `formatRange(41, 'tok/s', 'en')` is
 * `"30-52 tok/s"` with an en dash.
 *
 * The band is ROUNDED OUTWARD — the low end down, the high end up — so the
 * printed interval is never narrower than the interval the model produced.
 * The grid it rounds to is the magnitude rule above, coarsened to three
 * significant figures at or above 1000: a fleet figure printed as
 * "925,925-1,543,209" claims a precision the model does not have.
 *
 * This function never renders a bare point value. Use it for every number that
 * comes out of the throughput, latency or utilization model — see `formatPoint`
 * for the list of quantities that are exact instead.
 */
export function formatRange(v: number, unit: string, lang: Lang): string {
  if (!isFinal(v)) return EM_DASH

  const a = Math.abs(v)
  // Rounding grid: 10^-decimals, or 3 significant figures for large values.
  const decimals = a >= 1000 ? 0 : decimalsFor(v)
  const step = a >= 1000 ? 10 ** (Math.floor(Math.log10(a)) - 2) : 10 ** -decimals

  const x = v * (1 - UNCERTAINTY)
  const y = v * (1 + UNCERTAINTY)
  const lo = Math.floor(snap(Math.min(x, y) / step)) * step
  const hi = Math.ceil(snap(Math.max(x, y) / step)) * step

  return withUnit(`${fixed(lo, decimals, lang)}${EN_DASH}${fixed(hi, decimals, lang)}`, unit)
}

/**
 * EXACT quantity, rendered as a single number with no band.
 *
 * Exact — use `formatPoint` (or `formatGib` / `formatUsd` / `formatCount`):
 *   GPU count, node count, replica count, TP/PP/EP degrees, max GPUs per node,
 *   every memory figure (weights, KV, overhead, available, free, KV bytes per
 *   token, maxConcurrentSeqs), host RAM and disk, context length, DAU,
 *   requests per user per day, prompt/output token counts, peak factor,
 *   TDP-derived watts, and every price taken straight from pricing.json
 *   (capex, hourly rent, hourly power, TCO): all of these are arithmetic on
 *   catalog numbers the user chose, not model predictions.
 *
 * Uncertain — must go through `formatRange`:
 *   perUserTps, decodeCapacity, prefillCapacity, ttft, stepTime, prefillLoad,
 *   decodeLoad, commFraction, batch, saturatedTokensPerSec, and both
 *   $/1M-token figures (they divide an exact cost by a modelled throughput, so
 *   they inherit its +/-25%). `formatUsdPerMillion` renders the point value for
 *   the expanded cost breakdown; a headline $/1M figure should be banded.
 */
export function formatPoint(v: number, unit: string): string {
  if (!isFinal(v)) return EM_DASH
  // An exact integer prints as an integer: "8 GPU", never "8.0 GPU".
  return withUnit(fixed(v, Number.isInteger(v) ? 0 : decimalsFor(v), 'en'), unit)
}

/** Memory size. Accepts a `Bytes`-branded number: `formatGib(gib(141))` -> "141 GiB". */
export function formatGib(b: number): string {
  if (!isFinal(b)) return EM_DASH
  const g = b / GIB
  return `${fixed(g, decimalsFor(g), 'en')} GiB`
}

/** Price-list money. `null` (cost mode off, no price known) renders as an em dash. */
export function formatUsd(v: number | null): string {
  if (!isFinal(v)) return EM_DASH
  const a = Math.abs(v)
  const decimals = a >= 1000 ? 0 : a > 0 && a < 0.01 ? decimalsFor(a) : 2
  return `${v < 0 ? '-' : ''}$${fixed(a, decimals, 'en')}`
}

/**
 * Cost per million tokens at three significant figures: "$0.734", "$2.90".
 * Intl is used rather than `toPrecision` so large values group instead of
 * turning into "1.23e+3".
 */
export function formatUsdPerMillion(v: number | null): string {
  if (!isFinal(v)) return EM_DASH
  const a = Math.abs(v)
  const text = new Intl.NumberFormat(localeFor('en'), {
    minimumSignificantDigits: 3,
    maximumSignificantDigits: 3,
  }).format(a)
  return `${v < 0 ? '-' : ''}$${text}`
}

/** Whole count with thousands separators: 1234567 -> "1,234,567". */
export function formatCount(v: number): string {
  if (!isFinal(v)) return EM_DASH
  return fixed(Math.round(v), 0, 'en')
}

/** Duration in seconds, switching to milliseconds below one second. */
export function formatSeconds(v: number): string {
  if (!isFinal(v)) return EM_DASH
  if (Math.abs(v) < 1) {
    const ms = v * 1000
    return `${fixed(ms, decimalsFor(ms), 'en')} ms`
  }
  return `${fixed(v, decimalsFor(v), 'en')} s`
}

/** Fraction as a percentage: 0.16 -> "16%", 0.055 -> "5.5%". */
export function formatPercent(v: number): string {
  if (!isFinal(v)) return EM_DASH
  const p = snap(v * 100)
  return `${fixed(p, decimalsFor(p), 'en')}%`
}
