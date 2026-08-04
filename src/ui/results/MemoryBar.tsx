/**
 * MemoryBar — the per-GPU memory split as a CSS-only stacked bar.
 *
 * Spec §4 ("Визуализации"): no chart library; the memory breakdown is a flex
 * bar. Palette and contrast follow the `dataviz` skill:
 *
 * - Three categorical slots for the *allocated* segments — blue / orange / aqua,
 *   the skill's slots 1–3, which are the three that clear the all-pairs CVD and
 *   normal-vision floors in BOTH modes (validated: worst CVD ΔE 9.2 light /
 *   9.4 dark, worst normal-vision ΔE 24.0 light / 20.9 dark).
 * - "Free" is not a fourth series. It is the absence of allocation, so it wears
 *   the neutral track colour; giving it a hue would claim it is a thing.
 * - Light-mode aqua sits at 2.74:1 against the surface, below the skill's 3:1
 *   line, which obliges the *relief rule*: every segment carries a visible
 *   direct label with its size in the legend, so nothing is gated behind colour.
 * - The 2px separator between segments is an inset box-shadow in the surface
 *   colour — the skill's "surface gap", drawn *inside* the mark so it costs no
 *   layout width. That is what lets the four widths still sum to exactly 100%.
 */
import type { MemoryBreakdown } from '../../core/types'
import { fill, useLang } from '../i18n'
import { formatGib } from './format'

/** Stacking order, left to right. `free` is last so it absorbs the remainder. */
const SEGMENTS = ['weights', 'kv', 'overhead', 'free'] as const

export type MemorySegment = (typeof SEGMENTS)[number]

/** Fill colours per segment, light and dark. See the module comment. */
const FILL: Record<MemorySegment, string> = {
  weights: 'bg-[#2a78d6] dark:bg-[#3987e5]',
  kv: 'bg-[#eb6834] dark:bg-[#d95926]',
  overhead: 'bg-[#1baf7a] dark:bg-[#199e70]',
  free: 'bg-[#e1e0d9] dark:bg-[#383835]',
}

/** The surface gap: 2px of chart surface carved out of the segment's own edge. */
const GAP = 'shadow-[inset_-2px_0_0_0_#fcfcfb] dark:shadow-[inset_-2px_0_0_0_#1a1a19]'

const num = (v: number): number => (Number.isFinite(v) ? v : 0)

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4

/**
 * Segment widths as percentages that sum to exactly 100.
 *
 * The denominator is `availablePerGpu` — the HBM the framework is actually
 * allowed to claim — not the installed memory, because the bar is answering
 * "what did the allocation do with the budget", and the budget is what
 * `gpu-memory-utilization` left. The last segment is computed as the remainder
 * of the other three so rounding can never make the row over- or under-flow.
 */
export function memorySegmentPercents(memory: MemoryBreakdown): Record<MemorySegment, number> {
  const weightsB = num(memory.weightsPerGpu)
  const kvB = num(memory.kvPerGpu)
  const overheadB = num(memory.overheadPerGpu)
  const freeB = num(memory.freePerGpu)
  const total = Math.max(num(memory.availablePerGpu), weightsB + kvB + overheadB + freeB)

  if (!(total > 0)) return { weights: 0, kv: 0, overhead: 0, free: 100 }

  const pct = (b: number): number => round4(Math.max(0, Math.min(b, total)) / total * 100)
  const weights = pct(weightsB)
  const kv = pct(kvB)
  const overhead = pct(overheadB)

  return { weights, kv, overhead, free: Math.max(0, round4(100 - weights - kv - overhead)) }
}

export interface MemoryBarProps {
  /** The per-GPU split produced by `computeMemory`. */
  memory: MemoryBreakdown
  /** Show the labelled legend under the bar. Default `true`. */
  showLegend?: boolean
  className?: string
}

export default function MemoryBar({ memory, showLegend = true, className }: MemoryBarProps) {
  const { t } = useLang()
  const pct = memorySegmentPercents(memory)

  const sizes: Record<MemorySegment, string> = {
    weights: formatGib(memory.weightsPerGpu),
    kv: formatGib(memory.kvPerGpu),
    overhead: formatGib(memory.overheadPerGpu),
    free: formatGib(memory.freePerGpu),
  }

  const legend = fill(t.memoryBar.legend, sizes)
  const outOf = fill(t.memoryBar.outOf, { total: formatGib(memory.availablePerGpu) })
  // A segment only needs a trailing gap when something visible follows it.
  const followed = (index: number): boolean =>
    SEGMENTS.slice(index + 1).some((key) => pct[key] > 0)

  return (
    <div className={className}>
      <div
        role="img"
        aria-label={`${legend} ${outOf}`}
        className="flex h-2.5 w-full overflow-hidden rounded-[4px] bg-[#e1e0d9] dark:bg-[#383835]"
      >
        {SEGMENTS.map((key, index) => (
          <div
            key={key}
            data-segment={key}
            style={{ width: `${pct[key]}%` }}
            className={`h-full ${FILL[key]} ${
              pct[key] > 0 && followed(index) ? GAP : ''
            }`}
          />
        ))}
      </div>

      {showLegend ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#52514e] dark:text-[#c3c2b7]">
          {SEGMENTS.map((key) => (
            <li key={key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 shrink-0 rounded-[2px] ${FILL[key]}`}
              />
              <span>{t.memoryBar.segment[key]}</span>
              <span className="font-medium tabular-nums text-[#0b0b0b] dark:text-white">
                {sizes[key]}
              </span>
            </li>
          ))}
          <li className="text-[#898781]">{outOf}</li>
        </ul>
      ) : null}
    </div>
  )
}
