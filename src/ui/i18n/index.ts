/**
 * Typed i18n: dictionaries, the language context and a `{name}` interpolator.
 *
 * `Dict` is `typeof en` with every leaf widened from its string literal back to
 * `string`, which is what makes `const ru: Dict = {...}` useful: a missing or
 * misspelled key is a compile error, while a genuine translation is not.
 *
 * Implements the plan's Task 12 and the spec's §4 ("плоские словари en.ts / ru.ts,
 * типизированные по ключам EN, чтобы пропущенный перевод ловился компилятором").
 */
import { createContext, createElement, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import en from './en'
import ru from './ru'

export type Lang = 'en' | 'ru'

/** Recursively replaces string-literal leaves with `string`. */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> }

/** The shape every language must implement, keyed by the English dictionary. */
export type Dict = Widen<typeof en>

export const LANGS: readonly Lang[] = ['en', 'ru']

export const DEFAULT_LANG: Lang = 'en'

export const DICTS: Record<Lang, Dict> = { en, ru }

/** Narrows an arbitrary string (URL parameter, localStorage) to a known language. */
export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'ru'
}

/**
 * Substitute `{name}` placeholders.
 *
 * Unknown placeholders are left in place rather than blanked, so a missing
 * value shows up as `{gpus}` in the UI instead of a silent hole.
 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

export interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  t: Dict
}

const LangContext = createContext<LangContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: DICTS[DEFAULT_LANG],
})

export interface LangProviderProps {
  /**
   * Current language. When supplied the provider is controlled — the owner (the
   * app shell, which mirrors language into the URL) is responsible for reacting
   * to `onLangChange`. When omitted the provider keeps its own state.
   */
  lang?: Lang
  onLangChange?: (lang: Lang) => void
  children?: ReactNode
}

export function LangProvider({ lang, onLangChange, children }: LangProviderProps) {
  const controlled = lang !== undefined
  const [internal, setInternal] = useState<Lang>(lang ?? DEFAULT_LANG)
  const current = controlled ? lang : internal

  const setLang = useCallback(
    (next: Lang) => {
      if (!controlled) setInternal(next)
      onLangChange?.(next)
    },
    [controlled, onLangChange],
  )

  const value = useMemo<LangContextValue>(
    () => ({ lang: current, setLang, t: DICTS[current] }),
    [current, setLang],
  )

  return createElement(LangContext.Provider, { value }, children)
}

/**
 * Language and dictionary for the current subtree. Outside a provider it falls
 * back to English rather than throwing, so an isolated component test does not
 * have to mount the shell.
 */
export function useLang(): LangContextValue {
  return useContext(LangContext)
}

export { en, ru }
