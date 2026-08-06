/**
 * The shell — plan Task 16, spec §4 (layout) and §7 (error handling).
 *
 * Everything below this file is a pure function of the form state; the shell is
 * where that state is owned, mirrored into the URL, translated, themed and
 * turned into a `solve()` call. Three decisions are worth stating up front:
 *
 * 1. **Recomputation is synchronous.** The full sweep is a few thousand
 *    candidates of plain arithmetic, so `useMemo` over `solve()` runs inside the
 *    same render as the keystroke that caused it. No worker, no debounce, no
 *    spinner — the results move with the slider, which is the whole point of the
 *    tool (spec §4, "Пересчёт").
 * 2. **A failure is still an answer.** Zero surviving candidates renders the
 *    nearest miss and which knob to relax, never a bare empty list; a broken
 *    shared link falls back field by field and says so; a thrown render error is
 *    caught around the results column alone, leaving every input usable
 *    (spec §7).
 * 3. **The solver never runs outside a boundary's reach.** `solve()` is called
 *    in a memo that captures a throw instead of propagating it, and the captured
 *    error is re-thrown inside the boundary — so even a solver bug costs the
 *    user the results column rather than the page.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { solve } from '../core/solver'
import type { SolveArgs } from '../core/solver'
import type { Rejection, RejectionReason, SolveResult } from '../core/types'
import { ACCELERATORS, PRICING } from '../data'
import { estimate as estimateDeployment } from '../deploy'
import ErrorBoundary from './ErrorBoundary'
import { LangProvider, fill, isLang, useLang } from './i18n'
import type { Dict, Lang } from './i18n'
import { DeployPanel } from './panels/DeployPanel'
import { InputPanel, effectiveWorkload, selectedModel } from './panels/InputPanel'
import { solvePin } from './panels/VerifyPanel'
import DeployResults from './results/DeployResults'
import DeploymentCard from './results/DeploymentCard'
import HowComputed from './results/HowComputed'
import LoadSummary from './results/LoadSummary'
import RejectedTable from './results/RejectedTable'
import { formatPoint } from './results/format'
import { DEFAULT_STATE, OVERRIDE_KEYS, decodeState, encodeState, useUrlState } from './state'
import type { FormState, Tab } from './state'

export const GITHUB_URL = 'https://github.com/kryadov/llm-hardware-calculator'

export const THEME_STORAGE_KEY = 'llm-hardware-calculator:theme'
export const LANG_STORAGE_KEY = 'llm-hardware-calculator:lang'

export type Theme = 'light' | 'dark'

const TABS: readonly Tab[] = ['explore', 'verify', 'deploy']

/* ------------------------------------------------------------------ */
/* Storage and media queries — every one of them optional at runtime.   */
/* ------------------------------------------------------------------ */

/** localStorage throws in Safari private mode; a preference is never worth a crash. */
function readStored(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    /* Preferences are best-effort. */
  }
}

function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  try {
    return window.matchMedia('(prefers-color-scheme: dark)')
  } catch {
    return null
  }
}

/**
 * Theme: the system preference by default, a manual override once the user has
 * touched the toggle. The override lives in `localStorage` and is applied by
 * putting `dark` on `<html>`, which is what the Tailwind `dark` variant is bound
 * to in `index.css`.
 */
export function useTheme(): { theme: Theme; setTheme: (next: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = readStored(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return darkMediaQuery()?.matches ? 'dark' : 'light'
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Follow the OS while the user has not overridden it: someone on an automatic
  // day/night schedule should not have to reload at dusk.
  useEffect(() => {
    const mq = darkMediaQuery()
    if (!mq?.addEventListener) return
    const onChange = (e: MediaQueryListEvent): void => {
      if (readStored(THEME_STORAGE_KEY) !== null) return
      setThemeState(e.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    writeStored(THEME_STORAGE_KEY, next)
  }, [])

  return { theme, setTheme }
}

/**
 * Language lives in the URL (so a shared link opens in the sender's language)
 * and in `localStorage` (so a bare link opens in the reader's). The URL wins
 * when it carries `lang`, which is why the *initial* search string is captured
 * during the first render — by the time effects run, `useUrlState` has already
 * rewritten it.
 */
function useLangPreference(lang: Lang, patch: (patch: Partial<FormState>) => void): void {
  const initialSearch = useRef<string | null>(null)
  if (initialSearch.current === null) {
    initialSearch.current = typeof window === 'undefined' ? '' : window.location.search
  }
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const search = initialSearch.current ?? ''
    if (new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).has('lang')) return
    const stored = readStored(LANG_STORAGE_KEY)
    if (isLang(stored) && stored !== lang) patch({ lang: stored })
  }, [lang, patch])

  useEffect(() => {
    writeStored(LANG_STORAGE_KEY, lang)
  }, [lang])
}

/* ------------------------------------------------------------------ */
/* Did the incoming link survive decoding?                              */
/* ------------------------------------------------------------------ */

/**
 * A state that differs from the default in every field, used only to discover
 * which query-string keys `encodeState` can emit. Deriving the key set beats
 * hardcoding it: `state.ts` owns the URL vocabulary, and a key renamed there
 * must not silently turn this check into a no-op.
 */
const PROBE_STATE: FormState = {
  ...DEFAULT_STATE,
  tab: DEFAULT_STATE.tab === 'explore' ? 'verify' : 'explore',
  modelId: `${DEFAULT_STATE.modelId}~probe`,
  quant: DEFAULT_STATE.quant === 'fp8' ? 'bf16' : 'fp8',
  profileId: `${DEFAULT_STATE.profileId}~probe`,
  dau: DEFAULT_STATE.dau + 1,
  vendors: [],
  costMode: DEFAULT_STATE.costMode === 'rent' ? 'buy' : 'rent',
  lang: DEFAULT_STATE.lang === 'en' ? 'ru' : 'en',
  pin: { acceleratorId: '~probe', totalGpus: 2 },
}

const APP_URL_KEYS: ReadonlySet<string> = new Set<string>([
  ...new URLSearchParams(encodeState(PROBE_STATE)).keys(),
  ...OVERRIDE_KEYS.map((key) => `o.${String(key)}`),
])

/**
 * True when the link asked for something the decoder refused: an unknown model,
 * a number outside its plausible range, a truncated paste. Parameters this app
 * never emits (`utm_*` and friends) are ignored rather than reported.
 *
 * One benign false positive is accepted: a hand-written `?q=fp8`, naming a value
 * that already is the default, is reported as replaced — because `encodeState`
 * omits defaults, the two cases are indistinguishable from here. The resulting
 * calculation is exactly the one the link asked for either way.
 */
export function urlWasRepaired(search: string): boolean {
  if (search === '' || search === '?') return false
  try {
    const incoming = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    const kept = new URLSearchParams(encodeState(decodeState(search)))
    for (const [key, value] of incoming) {
      if (!APP_URL_KEYS.has(key)) continue
      if (kept.get(key) !== value) return true
    }
    return false
  } catch {
    return true
  }
}

/* ------------------------------------------------------------------ */
/* Reading a failed search                                              */
/* ------------------------------------------------------------------ */

export type Verdict = 'pass' | 'warn' | 'fail'

/** Verify mode's headline: does the pinned fleet hold the load? */
export function verifyVerdict(result: SolveResult): Verdict {
  const top = result.deployments[0]
  if (top === undefined) return 'fail'
  return top.warnings.length > 0 ? 'warn' : 'pass'
}

/** The candidate that came closest; `solve` already sorts near misses first. */
export function nearestMiss(result: SolveResult): Rejection | null {
  return result.rejections[0] ?? null
}

export type RelaxKey = 'context' | 'sla' | 'quant' | 'vendors' | 'dau'

/**
 * Which knob to relax, given what blocked the nearest miss (spec §7). Ordered
 * most-likely-to-help first, and deliberately never more than three: a list of
 * five suggestions is a list of none.
 */
export function relaxSuggestions(reason: RejectionReason | null): readonly RelaxKey[] {
  switch (reason) {
    case 'oom':
      return ['context', 'quant', 'dau']
    case 'slaTps':
      return ['sla', 'quant', 'dau']
    case 'slaTtft':
      return ['sla', 'context', 'dau']
    case 'interconnect':
    case 'nodeLimit':
    case 'tpNotDivisible':
      return ['vendors', 'quant']
    case 'unsupportedQuant':
      return ['quant', 'vendors']
    case 'contextTooLong':
      return ['context']
    case 'internal':
      return ['context', 'sla', 'vendors']
    default:
      return ['context', 'sla', 'vendors']
  }
}

/** "8× H200 141GB · FP8 · TP=8" — the nearest miss, named the way a card names it. */
function describeRejection(r: Rejection, t: Dict): string {
  const accelerator =
    ACCELERATORS.find((a) => a.id === r.acceleratorId)?.displayName ?? r.acceleratorId
  const gpus = r.parallelism.gpusPerReplica * Math.max(1, r.replicas)
  const parallelism = [
    `TP=${r.parallelism.tp}`,
    r.parallelism.pp > 1 ? `PP=${r.parallelism.pp}` : null,
    r.parallelism.ep > 1 ? `EP=${r.parallelism.ep}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ')
  const head = fill(t.card.title, { gpus: formatPoint(gpus, ''), accelerator })
  return `${head} · ${t.enums.quant[r.quant]} · ${parallelism}`
}

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                  */
/* ------------------------------------------------------------------ */

const CARD = 'rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-[#1a1a19]'
const HEADING = 'text-sm font-semibold text-[#0b0b0b] dark:text-white'
const BODY = 'text-xs leading-relaxed text-[#52514e] dark:text-[#c3c2b7]'
const MUTED = 'text-xs text-[#898781]'
const CHIP =
  'rounded-md px-2.5 py-1 text-xs font-medium text-[#52514e] hover:bg-black/[0.06] ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[#2a78d6] dark:text-[#c3c2b7] dark:hover:bg-white/10'

/**
 * A section the user opens on purpose. The button + conditional render is chosen
 * over `<details>` for the same reason as in `AdvancedPanel`: predictable state.
 * Collapsed it names the section; expanded it only offers the way back, because
 * the section it reveals carries its own heading.
 */
function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string
  defaultOpen?: boolean
  children: ReactNode
}): ReactElement {
  const { t } = useLang()
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`${CHIP} flex w-full items-center gap-2 text-left`}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        {open ? t.actions.collapse : label}
      </button>
      {open ? (
        <div id={id} className="mt-2">
          {children}
        </div>
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function Header({
  state,
  patch,
}: {
  state: FormState
  patch: (patch: Partial<FormState>) => void
}): ReactElement {
  const { t, lang, setLang } = useLang()
  const { theme, setTheme } = useTheme()
  const dark = theme === 'dark'

  return (
    <header className="sticky top-0 z-30 border-b border-black/10 bg-[#fcfcfb]/90 backdrop-blur dark:border-white/10 dark:bg-[#111110]/90">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-base font-semibold text-[#0b0b0b] dark:text-white">
            {t.header.title}
          </h1>
          <p className={`truncate ${MUTED}`}>{t.header.tagline}</p>
        </div>

        {/*
          No `aria-label` on the tablist: the two tabs name themselves, and every
          candidate label in the dictionary describes the app rather than the
          choice — a wrong name is worse than none.
        */}
        <div role="tablist" className="flex rounded-lg bg-black/[0.05] p-0.5 dark:bg-white/10">
          {TABS.map((tab) => (
            <button
              key={tab}
              id={`tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={state.tab === tab}
              aria-controls="workspace"
              title={t.header.tabHint[tab]}
              onClick={() => patch({ tab })}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                state.tab === tab
                  ? 'bg-white text-[#0b0b0b] shadow-sm dark:bg-[#2a2a28] dark:text-white'
                  : 'text-[#52514e] hover:text-[#0b0b0b] dark:text-[#c3c2b7] dark:hover:text-white'
              }`}
            >
              {t.header.tabs[tab]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <div
            className="flex rounded-lg bg-black/[0.05] p-0.5 dark:bg-white/10"
            role="group"
            aria-label={t.header.lang.label}
          >
            <button
              type="button"
              aria-label={t.header.lang.switchToEn}
              aria-pressed={lang === 'en'}
              onClick={() => setLang('en')}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                lang === 'en'
                  ? 'bg-white text-[#0b0b0b] shadow-sm dark:bg-[#2a2a28] dark:text-white'
                  : 'text-[#52514e] dark:text-[#c3c2b7]'
              }`}
            >
              {t.header.lang.en}
            </button>
            <button
              type="button"
              aria-label={t.header.lang.switchToRu}
              aria-pressed={lang === 'ru'}
              onClick={() => setLang('ru')}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                lang === 'ru'
                  ? 'bg-white text-[#0b0b0b] shadow-sm dark:bg-[#2a2a28] dark:text-white'
                  : 'text-[#52514e] dark:text-[#c3c2b7]'
              }`}
            >
              {t.header.lang.ru}
            </button>
          </div>

          <button
            type="button"
            aria-label={dark ? t.header.theme.toLight : t.header.theme.toDark}
            title={dark ? t.header.theme.toLight : t.header.theme.toDark}
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            className={CHIP}
          >
            <span aria-hidden="true">{dark ? '☀' : '☾'}</span>
          </button>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t.header.github.label}
            title={t.header.github.title}
            className={CHIP}
          >
            <span aria-hidden="true">↗ GH</span>
          </a>
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Empty states                                                        */
/* ------------------------------------------------------------------ */

function NoVendors(): ReactElement {
  const { t } = useLang()
  return (
    <section className={CARD} role="status">
      <h2 className={HEADING}>{t.empty.title}</h2>
      <p className={`mt-2 max-w-prose ${BODY}`}>{t.empty.noVendors}</p>
    </section>
  )
}

function NothingFits({ result }: { result: SolveResult }): ReactElement {
  const { t } = useLang()
  const miss = nearestMiss(result)

  return (
    <section className={CARD} role="status">
      <h2 className={HEADING}>{t.empty.title}</h2>
      <p className={`mt-2 max-w-prose ${BODY}`}>{t.empty.body}</p>

      {miss !== null ? (
        <div className="mt-3 rounded-lg bg-black/[0.04] p-3 dark:bg-white/[0.06]">
          <p className="text-xs font-medium text-[#0b0b0b] dark:text-white">
            {fill(t.empty.nearestMiss, { config: describeRejection(miss, t) })}
          </p>
          <p className={`mt-1 ${BODY}`}>
            {fill(t.empty.nearestMissReason, { reason: t.rejection.reason[miss.reason] })}
          </p>
          <p className={`mt-1 ${MUTED}`}>{t.rejection.reasonHelp[miss.reason]}</p>
        </div>
      ) : null}

      <h3 className={`mt-4 ${HEADING}`}>{t.empty.relaxTitle}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {relaxSuggestions(miss?.reason ?? null).map((key) => (
          <li key={key} className={`max-w-prose ${BODY}`}>
            {t.empty.relax[key]}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Results column                                                      */
/* ------------------------------------------------------------------ */

function Results({
  state,
  patch,
  outcome,
}: {
  state: FormState
  patch: (patch: Partial<FormState>) => void
  outcome: SolveResult | Error
}): ReactElement {
  const { t } = useLang()

  // Re-thrown inside the boundary on purpose: a solver that blows up costs the
  // results column, not the page.
  if (outcome instanceof Error) throw outcome

  const model = selectedModel(state)
  const workload = effectiveWorkload(state)
  const top = outcome.deployments[0]

  if (state.tab === 'deploy') {
    return (
      <div className="space-y-4">
        <LoadSummary derived={outcome.derived} />
        {top === undefined ? (
          <NothingFits result={outcome} />
        ) : (
          <DeployResults
            estimate={estimateDeployment({
              chosen: top,
              model,
              workload,
              accel: top.accelerator,
              inputs: state.deploy,
            })}
          />
        )}
      </div>
    )
  }

  const verify = state.tab === 'verify'
  const noVendors = !verify && state.vendors.length === 0

  const verdict = verifyVerdict(outcome)
  const verdictText =
    verdict === 'pass'
      ? t.input.verify.verdictPass
      : verdict === 'warn'
        ? t.input.verify.verdictWarn
        : t.input.verify.verdictFail
  const verdictTone =
    verdict === 'pass'
      ? 'border-[#1baf7a]/40 bg-[#1baf7a]/10'
      : verdict === 'warn'
        ? 'border-[#eb6834]/40 bg-[#eb6834]/10'
        : 'border-black/10 bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.06]'

  return (
    <div className="space-y-4">
      <LoadSummary derived={outcome.derived} />

      {verify ? (
        <p
          role="status"
          data-verdict={verdict}
          className={`rounded-xl border p-3 text-xs font-medium text-[#0b0b0b] dark:text-white ${verdictTone}`}
        >
          {verdictText}
        </p>
      ) : null}

      {noVendors ? (
        <NoVendors />
      ) : top === undefined ? (
        <NothingFits result={outcome} />
      ) : (
        outcome.deployments.map((deployment, i) => (
          <DeploymentCard
            key={`${deployment.acceleratorId}-${deployment.quant}-${deployment.parallelism.tp}-${deployment.parallelism.pp}`}
            deployment={deployment}
            model={model}
            best={i === 0}
            defaultExpanded={i === 0}
            onComputeTurnkey={() =>
              patch({
                tab: 'deploy',
                quant: deployment.quant,
                pin: { acceleratorId: deployment.acceleratorId, totalGpus: deployment.totalGpus },
              })
            }
            onVerify={() =>
              patch({
                tab: 'verify',
                quant: deployment.quant,
                pin: { acceleratorId: deployment.acceleratorId, totalGpus: deployment.totalGpus },
              })
            }
          />
        ))
      )}

      {outcome.rejections.length > 0 ? (
        <Disclosure
          label={fill(t.rejection.titleCount, {
            count: formatPoint(outcome.rejections.length, ''),
          })}
          defaultOpen={true}
        >
          <RejectedTable rejections={outcome.rejections} accelerators={ACCELERATORS} />
        </Disclosure>
      ) : null}

      {top !== undefined ? (
        <Disclosure label={t.howComputed.title}>
          <HowComputed
            model={model}
            workload={workload}
            derived={outcome.derived}
            deployment={top}
          />
        </Disclosure>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

/**
 * Carries the `data-testid` because an expanded `DeploymentCard` also renders a
 * `<footer>` — scoped to its `<article>`, so genuinely not a landmark, but the
 * accessibility-tree implementation used in tests does not apply that scoping
 * and `getByRole('contentinfo')` comes out ambiguous.
 */
function Footer(): ReactElement {
  const { t } = useLang()
  return (
    <footer
      data-testid="page-footer"
      className="mt-8 border-t border-black/10 dark:border-white/10"
    >
      <div className={`mx-auto max-w-[1500px] space-y-1 px-4 py-6 ${MUTED}`}>
        <p className="max-w-prose">{t.footer.accuracy}</p>
        <p className="max-w-prose">{t.footer.loadTesting}</p>
        <p>{fill(t.footer.pricesAsOf, { date: PRICING.pricesAsOf })}</p>
        <p className="max-w-prose">{t.footer.sources}</p>
        <p>{t.footer.offline}</p>
        <p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-[#0b0b0b] dark:hover:text-white"
          >
            {t.footer.repo}
          </a>
        </p>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function Shell({
  state,
  patch,
}: {
  state: FormState
  patch: (patch: Partial<FormState>) => void
}): ReactElement {
  const { t } = useLang()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  // Captured during the first render: by the time effects run, `useUrlState` has
  // already replaced the query string with its own canonical encoding.
  const initialSearch = useRef<string | null>(null)
  if (initialSearch.current === null) {
    initialSearch.current = typeof window === 'undefined' ? '' : window.location.search
  }
  const [repaired, setRepaired] = useState(() => urlWasRepaired(initialSearch.current ?? ''))

  /**
   * The whole calculation. Keyed on the state object, which `useUrlState`
   * replaces on every patch — so this runs exactly once per input change, in the
   * same render.
   */
  const outcome = useMemo<SolveResult | Error>(() => {
    try {
      // Verify pins a fleet by id; Deploy prices whatever is pinned there too
      // (spec §2.2) — both need the exact single candidate, not an enumeration.
      const pinned = state.tab === 'verify' || state.tab === 'deploy'
      const args: SolveArgs = {
        model: selectedModel(state),
        workload: effectiveWorkload(state),
        // Verify/Deploy pin one accelerator by id, so the vendor filter — which
        // the input panel hides on those tabs — must not be able to filter it away.
        accelerators: pinned
          ? ACCELERATORS
          : ACCELERATORS.filter((a) => state.vendors.includes(a.vendor)),
        quants: [state.quant],
        costMode: state.costMode,
        ...(pinned ? { pin: solvePin(state) } : {}),
      }
      return solve(args)
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  }, [state])

  const reset = (): void => {
    // The language is a reader preference rather than an input to the
    // calculation, so it survives a reset. So does the tab: resetting the
    // numbers while standing on Deploy used to teleport the user back to
    // Explore, which reads as a navigation bug rather than a reset. The pinned
    // configuration survives too, because Verify and Deploy have nothing to
    // show without it.
    patch({
      ...DEFAULT_STATE,
      tab: state.tab,
      pin: state.pin,
      lang: state.lang,
      overrides: {},
      vendors: [...DEFAULT_STATE.vendors],
    })
    setCopyState('idle')
  }

  const share = (): void => {
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    if (!write) {
      setCopyState('failed')
      return
    }
    write(window.location.href).then(
      () => setCopyState('copied'),
      () => setCopyState('failed'),
    )
  }

  const shareLabel =
    copyState === 'copied'
      ? t.actions.copied
      : copyState === 'failed'
        ? t.actions.copyFailed
        : t.input.share

  return (
    <div className="min-h-full bg-[#fcfcfb] text-[#0b0b0b] dark:bg-[#111110] dark:text-white">
      <Header state={state} patch={patch} />

      {/*
        The tabpanel sits inside <main> rather than on it: the tabs switch the
        whole workspace (both columns), but putting `role="tabpanel"` on <main>
        would cost the page its only main landmark.
      */}
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <div
          id="workspace"
          role="tabpanel"
          aria-labelledby={`tab-${state.tab}`}
          className="flex flex-col gap-6 lg:flex-row lg:items-start"
        >
          {state.tab === 'deploy' ? (
            <DeployPanel
              state={state}
              onChange={patch}
              className="w-full shrink-0 space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[380px] lg:overflow-y-auto lg:pr-2"
            />
          ) : (
            <InputPanel state={state} onChange={patch} />
          )}

          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={reset} className={CHIP}>
                {t.input.reset}
              </button>
              <button type="button" onClick={share} className={CHIP}>
                {shareLabel}
              </button>
            </div>

            {repaired ? (
              <div
                role="status"
                className="flex items-start gap-3 rounded-xl border border-[#eb6834]/40 bg-[#eb6834]/10 p-3"
              >
                <p className={`max-w-prose grow ${BODY}`}>{t.empty.urlFallback}</p>
                <button
                  type="button"
                  onClick={() => setRepaired(false)}
                  className={CHIP}
                  aria-label={t.actions.close}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ) : null}

            <ErrorBoundary
              resetKeys={[state]}
              fallback={() => (
                <section className={CARD} role="alert">
                  <h2 className={HEADING}>{t.empty.title}</h2>
                  <p className={`mt-2 max-w-prose ${BODY}`}>{t.empty.internalError}</p>
                </section>
              )}
            >
              <Results state={state} patch={patch} outcome={outcome} />
            </ErrorBoundary>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}

export default function App(): ReactElement {
  const [state, patch] = useUrlState()
  const setLang = useCallback((lang: Lang) => patch({ lang }), [patch])
  useLangPreference(state.lang, patch)

  return (
    <LangProvider lang={state.lang} onLangChange={setLang}>
      <Shell state={state} patch={patch} />
    </LangProvider>
  )
}
