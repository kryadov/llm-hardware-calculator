/**
 * App shell — plan Task 16.
 *
 * These tests drive the shell end to end: the real solver, the real catalogs and
 * the real panels. Nothing is stubbed except `DeploymentCard`, and only so that
 * one test can make the results column throw on demand and prove the error
 * boundary keeps the page alive (spec §7, "Error boundary на приложении —
 * последний рубеж").
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRICING } from '../data'
import { fill } from './i18n'
import en from './i18n/en'
import ru from './i18n/ru'

/**
 * A switch the mocked card reads at render time. `vi.hoisted` because
 * `vi.mock` factories run before the module body.
 */
const boom = vi.hoisted(() => ({ on: false }))

vi.mock('./results/DeploymentCard', async () => {
  const actual =
    await vi.importActual<typeof import('./results/DeploymentCard')>('./results/DeploymentCard')
  return {
    ...actual,
    default: (props: import('./results/DeploymentCard').DeploymentCardProps) => {
      if (boom.on) throw new Error('boom: DeploymentCard exploded')
      return createElement(actual.default, props)
    },
  }
})

import App, { LANG_STORAGE_KEY, THEME_STORAGE_KEY } from './App'

/** The literal part of a template before its first `{placeholder}`. */
const prefixOf = (template: string): string => template.split('{')[0].trim()

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const textOf = (template: string): RegExp => new RegExp(escapeRegExp(prefixOf(template)))

/** Cards expose their headline GPU count; counting them counts deployments. */
const cardCount = (): number => document.querySelectorAll('[data-figure="totalGpus"]').length

const setUrl = (search: string): void => {
  window.history.replaceState(null, '', `/${search}`)
}

beforeEach(() => {
  boom.on = false
  setUrl('')
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('renders without crashing and shows at least one deployment for the default state', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: en.header.title })).toBeInTheDocument()
    expect(screen.getByText(en.header.tagline)).toBeInTheDocument()

    // The input column and the results column are both present.
    expect(screen.getByLabelText(en.input.model.label)).toBeInTheDocument()
    expect(screen.getByLabelText(en.load.title)).toBeInTheDocument()

    expect(cardCount()).toBeGreaterThan(0)
    expect(screen.queryByText(en.empty.title)).not.toBeInTheDocument()
  })

  it('switching to the Verify tab renders the pinned-hardware controls', () => {
    render(<App />)

    expect(screen.queryByLabelText(en.input.verify.totalGpus)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: en.header.tabs.verify }))

    expect(screen.getByLabelText(en.input.verify.accelerator)).toBeInTheDocument()
    expect(screen.getByLabelText(en.input.verify.totalGpus)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: en.header.tabs.verify })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(window.location.search).toContain('tab=verify')
  })

  it('the Verify tab states a verdict for the pinned fleet', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: en.header.tabs.verify }))

    const verdicts = [
      en.input.verify.verdictPass,
      en.input.verify.verdictWarn,
      en.input.verify.verdictFail,
    ]
    const shown = verdicts.filter((v) => screen.queryByText(v) !== null)
    expect(shown).toHaveLength(1)
  })

  it('toggling language changes the rendered header text', () => {
    render(<App />)

    expect(screen.getByText(en.header.tagline)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: en.header.tabs.explore })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: en.header.lang.switchToRu }))

    expect(screen.getByText(ru.header.tagline)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: ru.header.tabs.explore })).toBeInTheDocument()
    expect(screen.queryByText(en.header.tagline)).not.toBeInTheDocument()
    expect(window.location.search).toContain('lang=ru')
  })

  it('remembers the language in localStorage and restores it when the URL is silent', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: en.header.lang.switchToRu }))
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('ru')

    first.unmount()
    setUrl('')

    render(<App />)
    expect(screen.getByText(ru.header.tagline)).toBeInTheDocument()
  })

  it('the theme toggle flips the dark class on the root element and persists the choice', () => {
    render(<App />)
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: en.header.theme.toDark }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: en.header.theme.toLight }))

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('links to the GitHub repository', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: en.header.github.label })).toHaveAttribute(
      'href',
      'https://github.com/kryadov/llm-hardware-calculator',
    )
  })

  it('the footer states the ±25-30% accuracy disclaimer and the prices as-of date', () => {
    render(<App />)
    // Not `getByRole('contentinfo')`: an expanded card renders an article-scoped
    // `<footer>` that the test-time accessibility tree also counts as a landmark.
    const footer = screen.getByTestId('page-footer')

    expect(within(footer).getByText(en.footer.accuracy)).toBeInTheDocument()
    expect(within(footer).getByText(/±25.30%/)).toBeInTheDocument()
    expect(within(footer).getByText(en.footer.loadTesting)).toBeInTheDocument()
    expect(
      within(footer).getByText(fill(en.footer.pricesAsOf, { date: PRICING.pricesAsOf })),
    ).toBeInTheDocument()
  })

  it('renders nearest-miss guidance instead of a bare empty list when nothing fits', () => {
    setUrl('?o.slaTokensPerSec=90000')
    render(<App />)

    expect(cardCount()).toBe(0)
    expect(screen.getByText(en.empty.title)).toBeInTheDocument()
    expect(screen.getByText(textOf(en.empty.nearestMiss))).toBeInTheDocument()
    expect(screen.getByText(textOf(en.empty.nearestMissReason))).toBeInTheDocument()
    expect(screen.getByText(en.empty.relaxTitle)).toBeInTheDocument()

    const relaxHints = Object.values(en.empty.relax).filter(
      (hint) => screen.queryByText(hint) !== null,
    )
    expect(relaxHints.length).toBeGreaterThan(0)
  })

  it('says which control is empty when every vendor is unchecked', () => {
    setUrl('?v=')
    render(<App />)

    expect(cardCount()).toBe(0)
    expect(screen.getByText(en.empty.noVendors)).toBeInTheDocument()
  })

  it('a broken link falls back to defaults and says so without dropping the calculation', () => {
    setUrl('?m=no-such-model&dau=1000000000000')
    render(<App />)

    expect(screen.getByText(en.empty.urlFallback)).toBeInTheDocument()
    expect(cardCount()).toBeGreaterThan(0)
  })

  it('does not cry wolf about a broken link when the URL is clean', () => {
    setUrl('?dau=2500&c=buy')
    render(<App />)

    expect(screen.queryByText(en.empty.urlFallback)).not.toBeInTheDocument()
    expect(screen.getByLabelText(en.input.dau.label)).toHaveValue(2500)
  })

  it('an error thrown inside results is caught by the boundary and the page survives', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    boom.on = true

    render(<App />)

    // The results column degraded to the fallback...
    expect(screen.getByText(en.empty.internalError)).toBeInTheDocument()
    expect(cardCount()).toBe(0)
    // ...while the header, the footer and the whole input column stayed usable.
    expect(screen.getByRole('heading', { level: 1, name: en.header.title })).toBeInTheDocument()
    expect(screen.getByTestId('page-footer')).toBeInTheDocument()

    const dau = screen.getByLabelText(en.input.dau.label)
    expect(dau).toBeInTheDocument()

    // Editing an input recomputes and clears the boundary, as the message promises.
    boom.on = false
    fireEvent.change(dau, { target: { value: '2000' } })

    expect(screen.queryByText(en.empty.internalError)).not.toBeInTheDocument()
    expect(cardCount()).toBeGreaterThan(0)

    spy.mockRestore()
  })

  it('mirrors input changes into the URL with replaceState, never pushState', () => {
    const push = vi.spyOn(window.history, 'pushState')
    render(<App />)

    fireEvent.change(screen.getByLabelText(en.input.dau.label), { target: { value: '4200' } })

    expect(window.location.search).toContain('dau=4200')
    expect(push).not.toHaveBeenCalled()
    push.mockRestore()
  })

  it('recomputes synchronously: a DAU change moves the results in the same render', () => {
    render(<App />)
    const before = screen.getByTestId('derived-load').textContent

    fireEvent.change(screen.getByLabelText(en.input.dau.label), { target: { value: '50000' } })

    expect(screen.getByTestId('derived-load').textContent).not.toBe(before)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
