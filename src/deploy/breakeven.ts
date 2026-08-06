/**
 * Buy-vs-rent crossover — spec §8.2.
 *
 * Deliberately compares FULLY-LOADED numbers: buying's one-time cost against
 * the fully-loaded monthly gap to renting (both already carry facility,
 * staffing, support and software from `estimate.ts`), not GPU price against
 * GPU rental rate. That is the point of the whole page — a crossover computed
 * on card price alone would just repeat the number page 1 already ranks by.
 */
import { add, mid, scale } from './range'
import type { BreakevenResult, MoneyRange } from './types'

export function computeBreakeven(args: {
  buyOneTimeUsd: MoneyRange
  buyMonthlyUsd: MoneyRange
  rentMonthlyUsd: MoneyRange
  horizonMonths: number
}): BreakevenResult {
  const { buyOneTimeUsd, buyMonthlyUsd, rentMonthlyUsd, horizonMonths } = args
  if (buyOneTimeUsd === null || buyMonthlyUsd === null || rentMonthlyUsd === null) {
    return { breakevenMonths: null, buyTco: null, rentTco: null }
  }

  const monthlyDeltaMid = mid(rentMonthlyUsd) - mid(buyMonthlyUsd)
  const breakevenMonths = monthlyDeltaMid > 0 ? mid(buyOneTimeUsd) / monthlyDeltaMid : null

  const buyTco = add(buyOneTimeUsd, scale(buyMonthlyUsd, horizonMonths))
  const rentTco = scale(rentMonthlyUsd, horizonMonths)

  return { breakevenMonths, buyTco, rentTco }
}
