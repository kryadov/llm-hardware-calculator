import { describe, it, expect } from 'vitest'
import { add, addM, mid, point, scale, scaleM, sum, sumM, width } from './range'

describe('range arithmetic', () => {
  it('point collapses to a zero-width range', () => {
    expect(point(5)).toEqual({ low: 5, high: 5 })
    expect(width(point(5))).toBe(0)
  })

  it('add sums both ends independently', () => {
    expect(add({ low: 1, high: 2 }, { low: 10, high: 20 })).toEqual({ low: 11, high: 22 })
  })

  it('scale by a positive factor keeps ordering', () => {
    expect(scale({ low: 1, high: 2 }, 3)).toEqual({ low: 3, high: 6 })
  })

  it('scale by a negative factor swaps ends so low <= high still holds', () => {
    const r = scale({ low: 1, high: 2 }, -1)
    expect(r.low).toBeLessThanOrEqual(r.high)
    expect(r).toEqual({ low: -2, high: -1 })
  })

  it('sum of several ranges never produces low > high', () => {
    const s = sum([{ low: 1, high: 5 }, { low: -3, high: 2 }, { low: 0, high: 0 }])
    expect(s.low).toBeLessThanOrEqual(s.high)
  })

  it('mid is the midpoint', () => {
    expect(mid({ low: 2, high: 8 })).toBe(5)
  })
})

describe('MoneyRange propagation', () => {
  it('addM propagates null instead of treating it as zero', () => {
    expect(addM(point(5), null)).toBeNull()
    expect(addM(null, null)).toBeNull()
    expect(addM(point(5), point(3))).toEqual({ low: 8, high: 8 })
  })

  it('sumM returns null if any item is null', () => {
    expect(sumM([point(1), point(2), null])).toBeNull()
    expect(sumM([point(1), point(2)])).toEqual({ low: 3, high: 3 })
  })

  it('scaleM propagates null', () => {
    expect(scaleM(null, 2)).toBeNull()
    expect(scaleM(point(5), 2)).toEqual({ low: 10, high: 10 })
  })
})
