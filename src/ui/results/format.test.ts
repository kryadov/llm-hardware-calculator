import { describe, it, expect } from 'vitest'
import { UNCERTAINTY } from '../../core/types'
import { gib } from '../../core/units'
import {
  EM_DASH,
  EN_DASH,
  formatCount,
  formatGib,
  formatPercent,
  formatPoint,
  formatRange,
  formatSeconds,
  formatUsd,
  formatUsdPerMillion,
} from './format'

const NOT_A_NUMBER: unknown[] = [NaN, Infinity, -Infinity, null, undefined]

describe('dash constants', () => {
  it('uses the typographic en dash for ranges and em dash for missing data', () => {
    expect(EN_DASH).toBe('–')
    expect(EM_DASH).toBe('—')
    expect(EN_DASH).not.toBe('-')
  })
})

describe('formatRange', () => {
  it('renders the spec band around the point value', () => {
    expect(formatRange(41, 'tok/s', 'en')).toBe(`30${EN_DASH}52 tok/s`)
  })

  it('derives the band from UNCERTAINTY, not a hardcoded 0.25', () => {
    const v = 200
    const out = formatRange(v, '', 'en')
    const [lo, hi] = out.split(EN_DASH).map(Number)
    expect(lo).toBeLessThanOrEqual(v * (1 - UNCERTAINTY))
    expect(hi).toBeGreaterThanOrEqual(v * (1 + UNCERTAINTY))
  })

  it('never renders a bare point value', () => {
    for (const v of [0, 0.004, 0.16, 1, 7.3, 41, 112, 9_400, 1_234_567]) {
      const out = formatRange(v, 'tok/s', 'en')
      expect(out).toContain(EN_DASH)
      expect(out).not.toBe(`${v} tok/s`)
    }
  })

  it('rounds outward so the printed band is never narrower than the computed one', () => {
    // 41 * 0.75 = 30.75 -> 30 ; 41 * 1.25 = 51.25 -> 52
    expect(formatRange(41, '', 'en')).toBe(`30${EN_DASH}52`)
  })

  it('uses no decimals at or above 10', () => {
    expect(formatRange(112, 'req/s', 'en')).toBe(`84${EN_DASH}140 req/s`)
    expect(formatRange(12, '', 'en')).toBe(`9${EN_DASH}15`)
  })

  it('uses one decimal below 10', () => {
    expect(formatRange(7.2, 's', 'en')).toBe(`5.4${EN_DASH}9.0 s`)
    expect(formatRange(1, '', 'en')).toBe(`0.7${EN_DASH}1.3`)
  })

  it('keeps two significant digits below one', () => {
    expect(formatRange(0.16, '', 'en')).toBe(`0.12${EN_DASH}0.20`)
    expect(formatRange(0.004, '', 'en')).toBe(`0.0030${EN_DASH}0.0050`)
  })

  it('coarsens large values to three significant figures instead of faking precision', () => {
    expect(formatRange(1_234_567, 'tok/s', 'en')).toBe(`920,000${EN_DASH}1,550,000 tok/s`)
    expect(formatRange(9_400, 'tok/s', 'en')).toBe(`7,050${EN_DASH}11,750 tok/s`)
  })

  it('formats numbers for the requested language', () => {
    const ru = formatRange(7.2, 'с', 'ru')
    expect(ru).toBe(`5,4${EN_DASH}9,0 с`)
    expect(ru).not.toContain('.')
  })

  it('omits the separator when the unit is empty', () => {
    expect(formatRange(41, '', 'en')).not.toMatch(/\s$/)
  })

  it('handles a zero point value without producing junk', () => {
    expect(formatRange(0, 'tok/s', 'en')).toBe(`0${EN_DASH}0 tok/s`)
  })

  it('orders the bounds for negative values', () => {
    expect(formatRange(-41, '', 'en')).toBe(`-52${EN_DASH}-30`)
  })

  it('falls back to en for an unknown language tag', () => {
    expect(formatRange(7.2, 's', 'de' as never)).toBe(formatRange(7.2, 's', 'en'))
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatRange(v as number, 'tok/s', 'en')).toBe(EM_DASH)
  })
})

describe('formatPoint', () => {
  it('renders exact integers with their unit', () => {
    expect(formatPoint(8, 'GPU')).toBe('8 GPU')
    expect(formatPoint(2, 'nodes')).toBe('2 nodes')
  })

  it('never widens an exact quantity into a band', () => {
    expect(formatPoint(8, 'GPU')).not.toContain(EN_DASH)
  })

  it('groups thousands', () => {
    expect(formatPoint(12_800, 'tok')).toBe('12,800 tok')
  })

  it('keeps a sensible number of decimals for non-integers', () => {
    expect(formatPoint(1.5, 'x')).toBe('1.5 x')
    expect(formatPoint(141.7, 'GiB')).toBe('142 GiB')
  })

  it('omits the space when the unit is empty', () => {
    expect(formatPoint(8, '')).toBe('8')
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatPoint(v as number, 'GPU')).toBe(EM_DASH)
  })
})

describe('formatGib', () => {
  it('converts a Bytes-branded value to GiB', () => {
    expect(formatGib(gib(141))).toBe('141 GiB')
  })

  it('rounds large sizes to whole GiB', () => {
    expect(formatGib(gib(334.6))).toBe('335 GiB')
  })

  it('keeps one decimal below 10 GiB', () => {
    expect(formatGib(gib(2.25))).toBe('2.3 GiB')
  })

  it('keeps two significant digits below 1 GiB', () => {
    expect(formatGib(gib(0.5))).toBe('0.50 GiB')
  })

  it('renders zero', () => {
    expect(formatGib(gib(0))).toBe('0 GiB')
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatGib(v as number)).toBe(EM_DASH)
  })
})

describe('formatUsd', () => {
  it('renders large capex without decimals', () => {
    expect(formatUsd(1_234_567)).toBe('$1,234,567')
    expect(formatUsd(240_000)).toBe('$240,000')
  })

  it('renders small amounts with cents', () => {
    expect(formatUsd(23.52)).toBe('$23.52')
    expect(formatUsd(0.73)).toBe('$0.73')
  })

  it('places the sign before the currency symbol', () => {
    expect(formatUsd(-12.5)).toBe('-$12.50')
  })

  it('renders zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })

  it('keeps two significant digits for sub-cent amounts', () => {
    expect(formatUsd(0.004)).toBe('$0.0040')
  })

  it('renders null as an em dash, never "null"', () => {
    expect(formatUsd(null)).toBe(EM_DASH)
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatUsd(v as number)).toBe(EM_DASH)
  })
})

describe('formatUsdPerMillion', () => {
  it('renders three significant figures', () => {
    expect(formatUsdPerMillion(0.7341)).toBe('$0.734')
    expect(formatUsdPerMillion(2.9)).toBe('$2.90')
    expect(formatUsdPerMillion(12.3456)).toBe('$12.3')
  })

  it('never uses exponent notation for large values', () => {
    const out = formatUsdPerMillion(1234)
    expect(out).toBe('$1,230')
    expect(out).not.toContain('e')
  })

  it('renders zero', () => {
    expect(formatUsdPerMillion(0)).toBe('$0.00')
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatUsdPerMillion(v as number)).toBe(EM_DASH)
  })
})

describe('formatCount', () => {
  it('inserts thousands separators', () => {
    expect(formatCount(1_234_567)).toBe('1,234,567')
    expect(formatCount(112)).toBe('112')
  })

  it('rounds to a whole count', () => {
    expect(formatCount(112.6)).toBe('113')
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatCount(v as number)).toBe(EM_DASH)
  })
})

describe('formatSeconds', () => {
  it('renders seconds above one second', () => {
    expect(formatSeconds(1.8)).toBe('1.8 s')
    expect(formatSeconds(45.2)).toBe('45 s')
  })

  it('renders milliseconds below one second', () => {
    expect(formatSeconds(0.34)).toBe('340 ms')
    expect(formatSeconds(0.0004)).toBe('0.40 ms')
  })

  it('renders zero as milliseconds', () => {
    expect(formatSeconds(0)).toBe('0 ms')
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatSeconds(v as number)).toBe(EM_DASH)
  })
})

describe('formatPercent', () => {
  it('renders a fraction as a percentage', () => {
    expect(formatPercent(0.16)).toBe('16%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('keeps one decimal for small percentages', () => {
    expect(formatPercent(0.055)).toBe('5.5%')
  })

  it('renders zero', () => {
    expect(formatPercent(0)).toBe('0%')
  })

  it.each(NOT_A_NUMBER)('renders %s as an em dash', (v) => {
    expect(formatPercent(v as number)).toBe(EM_DASH)
  })
})

describe('totality', () => {
  const all: Array<[string, (v: number) => string]> = [
    ['formatRange', (v) => formatRange(v, 'tok/s', 'en')],
    ['formatPoint', (v) => formatPoint(v, 'GPU')],
    ['formatGib', formatGib],
    ['formatUsd', formatUsd],
    ['formatUsdPerMillion', formatUsdPerMillion],
    ['formatCount', formatCount],
    ['formatSeconds', formatSeconds],
    ['formatPercent', formatPercent],
  ]

  it('no formatter ever emits NaN, null, undefined or Infinity as text', () => {
    for (const [name, fn] of all) {
      for (const bad of NOT_A_NUMBER) {
        const out = fn(bad as number)
        expect(out, name).toBe(EM_DASH)
        expect(out, name).not.toMatch(/NaN|null|undefined|Infinity/)
      }
    }
  })

  it('every formatter returns a non-empty string for a plausible value', () => {
    for (const [name, fn] of all) {
      expect(fn(0.5).length, name).toBeGreaterThan(0)
      expect(fn(1024 ** 3 * 4).length, name).toBeGreaterThan(0)
    }
  })
})
