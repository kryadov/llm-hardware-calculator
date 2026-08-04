import { describe, it, expect } from 'vitest'
import { gib, toGib, gbPerSec, tflops } from './units'

describe('units', () => {
  it('gib uses binary multiples', () => {
    expect(gib(1)).toBe(1073741824)
  })
  it('toGib round-trips', () => {
    expect(toGib(gib(141))).toBeCloseTo(141, 9)
  })
  it('gbPerSec uses decimal multiples', () => {
    expect(gbPerSec(4800)).toBe(4.8e12)
  })
  it('tflops uses decimal multiples', () => {
    expect(tflops(989)).toBe(9.89e14)
  })
})
