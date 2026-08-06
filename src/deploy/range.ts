/**
 * Arithmetic over `Range` and `MoneyRange` — spec §2.3.
 *
 * `MoneyRange` is `Range | null`, `null` meaning "cannot be priced". Every
 * combinator here propagates `null` rather than treating it as zero, so a
 * missing price surfaces as a missing total instead of a silently understated
 * one — the same discipline `core/cost.ts` applies to `Usd | null`.
 */
import type { MoneyRange, Range } from './types'

export const ZERO: Range = { low: 0, high: 0 }

export function point(v: number): Range {
  return { low: v, high: v }
}

/** A `RangeValue`-shaped catalog rate (`{low, high}`) is already a `Range`. */
export function fromRate(rate: { low: number; high: number }): Range {
  return { low: rate.low, high: rate.high }
}

export function add(a: Range, b: Range): Range {
  return { low: a.low + b.low, high: a.high + b.high }
}

export function scale(a: Range, k: number): Range {
  if (!Number.isFinite(k)) return { low: NaN, high: NaN }
  return k >= 0 ? { low: a.low * k, high: a.high * k } : { low: a.high * k, high: a.low * k }
}

export function sum(rs: Range[]): Range {
  return rs.reduce(add, ZERO)
}

export function width(a: Range): number {
  return a.high - a.low
}

export function mid(a: Range): number {
  return (a.low + a.high) / 2
}

/** Collapses a range to a user-supplied point value, e.g. a real quote. */
export function override(_a: Range, value: number): Range {
  return point(value)
}

/* -------------------------------------------------------------------- */
/* MoneyRange — Range | null, null propagates                            */
/* -------------------------------------------------------------------- */

export function moneyPoint(v: number | null): MoneyRange {
  return v === null || !Number.isFinite(v) ? null : point(v)
}

export function addM(a: MoneyRange, b: MoneyRange): MoneyRange {
  if (a === null || b === null) return null
  return add(a, b)
}

export function sumM(rs: MoneyRange[]): MoneyRange {
  return rs.reduce(addM, ZERO as MoneyRange)
}

export function scaleM(a: MoneyRange, k: number): MoneyRange {
  return a === null ? null : scale(a, k)
}

/** Applies a user override (a point rate) to a money range, keyed by id. */
export function applyOverride(id: string, current: MoneyRange, overrides?: Partial<Record<string, number>>, multiplier = 1): MoneyRange {
  const v = overrides?.[id]
  if (v === undefined) return current
  return point(v * multiplier)
}
