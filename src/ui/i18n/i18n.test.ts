import { createElement } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import en from './en'
import ru from './ru'
import { DICTS, LangProvider, fill, useLang, type Lang } from './index'

import type { RejectionReason, Warning } from '../../core/types'

const REJECTION_REASONS: RejectionReason[] = [
  'oom',
  'slaTps',
  'slaTtft',
  'interconnect',
  'tpNotDivisible',
  'nodeLimit',
  'unsupportedQuant',
  'contextTooLong',
  'internal',
]

const WARNING_KINDS: Warning['kind'][] = [
  'slaTps',
  'slaTtft',
  'degradedInterconnect',
  'immatureStack',
]

const keys = (o: object): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v).map((s) => `${k}.${s}`) : [k],
  )

const walk = (o: object, visit: (path: string, value: unknown) => void, prefix = ''): void => {
  for (const [k, v] of Object.entries(o)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'object' && v !== null) walk(v, visit, path)
    else visit(path, v)
  }
}

describe('dictionary shape', () => {
  it('ru covers every en key', () => {
    expect(keys(ru).sort()).toEqual(keys(en).sort())
  })

  it('every leaf is a non-empty string in both languages', () => {
    for (const dict of [en, ru]) {
      walk(dict, (path, value) => {
        expect(typeof value, path).toBe('string')
        expect(String(value).trim().length, path).toBeGreaterThan(0)
      })
    }
  })

  it('ru is actually translated, not a copy of en', () => {
    // Units, enum labels (NVIDIA, NVLink, FP8) and the code in `.formula` leaves
    // are identical by design; prose is not allowed to be.
    // Established English terms engineers use verbatim in Russian (TTFT, tensor
    // parallel, MoE, CAPEX), language codes, CLI flag names and pure placeholder
    // templates. Inventing Russian calques for these would read worse, not better.
    const SHARED = new Set([
      'header.title',
      'header.lang.en',
      'header.lang.ru',
      'header.github.label',
      'input.model.source',
      'input.model.badgeMoe',
      'input.model.badgeDense',
      'input.profile.custom',
      'input.dau.short',
      'advanced.gpuMemUtil.label',
      'advanced.slaTtftSeconds.label',
      'load.peakRps',
      'card.title',
      'card.subtitle',
      'card.tp',
      'card.pp',
      'card.ep',
      'card.ttft',
      'card.capex',
    ])
    const byDesign = (path: string) =>
      path.startsWith('units.') ||
      path.startsWith('enums.') ||
      path.endsWith('.formula') ||
      SHARED.has(path)

    const enLeaves: Record<string, unknown> = {}
    walk(en, (path, value) => {
      enLeaves[path] = value
    })
    const untranslated: string[] = []
    walk(ru, (path, value) => {
      if (!byDesign(path) && enLeaves[path] === value) untranslated.push(path)
    })
    expect(untranslated).toEqual([])
  })

  it('placeholders match between languages', () => {
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
    const enLeaves: Record<string, string> = {}
    walk(en, (path, value) => {
      enLeaves[path] = String(value)
    })
    walk(ru, (path, value) => {
      expect(placeholders(String(value)), path).toEqual(placeholders(enLeaves[path]))
    })
  })
})

describe('coverage required by the spec', () => {
  it('names every RejectionReason', () => {
    for (const reason of REJECTION_REASONS) {
      expect(en.rejection.reason[reason]).toBeTruthy()
      expect(ru.rejection.reason[reason]).toBeTruthy()
    }
    expect(Object.keys(en.rejection.reason).sort()).toEqual([...REJECTION_REASONS].sort())
  })

  it('names every Warning kind', () => {
    for (const kind of WARNING_KINDS) {
      expect(en.warning[kind]).toBeTruthy()
      expect(ru.warning[kind]).toBeTruthy()
    }
    expect(Object.keys(en.warning).sort()).toEqual([...WARNING_KINDS].sort())
  })

  it('names the four memory bar segments', () => {
    expect(Object.keys(en.memoryBar.segment).sort()).toEqual(['free', 'kv', 'overhead', 'weights'])
  })

  it('distinguishes the two price figures unambiguously', () => {
    expect(en.card.pricePerMOutput.toLowerCase()).toContain('output')
    expect(en.card.pricePerMOutputNote.toLowerCase()).toContain('api')
    expect(en.card.pricePerMBlended.toLowerCase()).toContain('blended')
    expect(en.card.pricePerMOutput).not.toBe(en.card.pricePerMBlended)
    expect(ru.card.pricePerMOutput).not.toBe(ru.card.pricePerMBlended)
  })

  it('carries an advanced-panel hint for every advanced control', () => {
    for (const key of [
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
    ] as const) {
      expect(en.advanced[key].label.length).toBeGreaterThan(0)
      expect(en.advanced[key].hint.length).toBeGreaterThan(10)
      expect(ru.advanced[key].hint.length).toBeGreaterThan(10)
    }
  })

  it('carries the footer disclaimer with the accuracy band and a price date slot', () => {
    expect(en.footer.accuracy).toMatch(/25/)
    expect(en.footer.loadTesting.toLowerCase()).toContain('load test')
    expect(en.footer.pricesAsOf).toContain('{date}')
    expect(ru.footer.pricesAsOf).toContain('{date}')
  })

  it('carries empty-state guidance naming the knobs to relax', () => {
    expect(en.empty.title.length).toBeGreaterThan(0)
    expect(en.empty.nearestMiss).toContain('{config}')
    for (const knob of ['context', 'sla', 'quant'] as const) {
      expect(en.empty.relax[knob].length).toBeGreaterThan(10)
      expect(ru.empty.relax[knob].length).toBeGreaterThan(10)
    }
  })

  it('has the top-level groups the UI panels consume', () => {
    for (const group of [
      'header',
      'input',
      'advanced',
      'load',
      'card',
      'memoryBar',
      'rejection',
      'warning',
      'howComputed',
      'empty',
      'footer',
      'units',
      'enums',
      'actions',
    ] as const) {
      expect(en[group]).toBeTypeOf('object')
    }
  })
})

describe('fill', () => {
  it('substitutes named placeholders', () => {
    expect(fill('Prices as of {date}.', { date: '2026-08-04' })).toBe('Prices as of 2026-08-04.')
  })

  it('substitutes a placeholder used more than once', () => {
    expect(fill('{a} and {a}', { a: 'x' })).toBe('x and x')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(fill('{a} {b}', { a: '1' })).toBe('1 {b}')
  })
})

describe('DICTS', () => {
  it('maps both languages', () => {
    const langs: Lang[] = ['en', 'ru']
    expect(Object.keys(DICTS).sort()).toEqual(langs.sort())
    expect(DICTS.en).toBe(en)
    expect(DICTS.ru).toBe(ru)
  })
})

function Probe() {
  const { lang, setLang, t } = useLang()
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'lang' }, lang),
    createElement('span', { 'data-testid': 'explore' }, t.header.tabs.explore),
    createElement(
      'button',
      { onClick: () => setLang(lang === 'en' ? 'ru' : 'en') },
      'toggle',
    ),
  )
}

describe('useLang', () => {
  it('defaults to English and exposes that dictionary', () => {
    render(createElement(LangProvider, null, createElement(Probe)))
    expect(screen.getByTestId('lang')).toHaveTextContent('en')
    expect(screen.getByTestId('explore')).toHaveTextContent(en.header.tabs.explore)
  })

  it('honours the initial language passed to the provider', () => {
    render(createElement(LangProvider, { lang: 'ru' as Lang }, createElement(Probe)))
    expect(screen.getByTestId('explore')).toHaveTextContent(ru.header.tabs.explore)
  })

  it('setLang swaps the dictionary for every consumer', () => {
    render(createElement(LangProvider, null, createElement(Probe)))
    act(() => {
      screen.getByRole('button').click()
    })
    expect(screen.getByTestId('lang')).toHaveTextContent('ru')
    expect(screen.getByTestId('explore')).toHaveTextContent(ru.header.tabs.explore)
  })

  it('calls onLangChange so the shell can mirror the language into the URL', () => {
    const seen: Lang[] = []
    render(
      createElement(
        LangProvider,
        { onLangChange: (l: Lang) => seen.push(l) },
        createElement(Probe),
      ),
    )
    act(() => {
      screen.getByRole('button').click()
    })
    expect(seen).toEqual(['ru'])
  })

  it('falls back to English outside a provider rather than throwing', () => {
    render(createElement(Probe))
    expect(screen.getByTestId('lang')).toHaveTextContent('en')
  })
})
