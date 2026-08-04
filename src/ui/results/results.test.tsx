/**
 * Task 15 — results rendering.
 *
 * Every test named in the plan's Task 15 Step 2 appears here as a real test,
 * plus coverage for `LoadSummary` and for the two things the core change added
 * after the plan was written: the output-only price is the headline figure and
 * the blended one is never allowed to impersonate it.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type {
  AcceleratorSpec,
  CostBreakdown,
  Deployment,
  DerivedLoad,
  MemoryBreakdown,
  ModelSpec,
  Parallelism,
  Performance,
  Rejection,
  Workload,
} from '../../core/types'
import { bytes, gib, seconds, tokensPerSec, usd, watts } from '../../core/units'
import { en, fill } from '../i18n'

import DeploymentCard from './DeploymentCard'
import HowComputed from './HowComputed'
import LoadSummary from './LoadSummary'
import MemoryBar from './MemoryBar'
import RejectedTable from './RejectedTable'
import { EN_DASH, formatRange } from './format'

/* ------------------------------------------------------------------ */
/* Fixtures — hand-built so every rendered number is known exactly.     */
/* ------------------------------------------------------------------ */

const ACCEL: AcceleratorSpec = {
  id: 'h200',
  vendor: 'nvidia',
  displayName: 'NVIDIA H200 141GB',
  memoryGib: 141,
  memBandwidthGbs: 4800,
  peakTflops: { bf16: 989, fp8: 1979, int8: 1979 },
  tdpWatts: 700,
  maxPerNode: 8,
  intraNode: 'nvlink',
  intraNodeGbs: 900,
  frameworks: ['vllm', 'sglang'],
  coefficientFamily: 'nvidia-hopper-blackwell',
  releaseYear: 2024,
}

const MODEL: ModelSpec = {
  id: 'deepseek-v3.2',
  family: 'DeepSeek',
  displayName: 'DeepSeek-V3.2',
  hfRepo: 'deepseek-ai/DeepSeek-V3.2',
  totalParams: 671e9,
  activeParams: 37e9,
  layers: 61,
  hiddenSize: 7168,
  vocabSize: 129280,
  attention: {
    type: 'mla',
    heads: 128,
    headDim: 128,
    kvLoraRank: 512,
    qkRopeHeadDim: 64,
    shardedByTp: false,
  },
  moe: { experts: 256, topK: 8, sharedExperts: 1, denseLayers: 3 },
  maxContext: 131072,
  nativeDtype: 'fp8',
  sourceUrl: 'https://huggingface.co/deepseek-ai/DeepSeek-V3.2/blob/main/config.json',
  verifiedAt: '2026-07-01',
}

const PARALLELISM: Parallelism = {
  tp: 8,
  pp: 1,
  ep: 8,
  gpusPerReplica: 8,
  nodesPerReplica: 1,
  requiredInterconnect: 'nvlink',
  bubblePenalty: 0,
}

/** 42 + 76 + 8.9 == 126.9 == available, exactly as `computeMemory` produces. */
const MEMORY: MemoryBreakdown = {
  weightsPerGpu: gib(42),
  kvPerGpu: gib(76),
  overheadPerGpu: gib(8.9),
  availablePerGpu: gib(126.9),
  freePerGpu: gib(0),
  kvBytesPerToken: bytes(73728),
  maxConcurrentSeqs: 512,
  kvReplication: 1,
}

const PERFORMANCE: Performance = {
  perUserTps: tokensPerSec(41),
  decodeCapacity: tokensPerSec(9800),
  prefillCapacity: tokensPerSec(120000),
  ttft: seconds(1.8),
  stepTime: seconds(0.0244),
  prefillLoad: 0.31,
  decodeLoad: 0.28,
  commFraction: 0.12,
  batch: 96,
}

const COST: CostBreakdown = {
  capex: usd(320000),
  hourlyRent: usd(23.52),
  powerWatts: watts(7280),
  hourlyPower: usd(0.87),
  tco3y: usd(342800),
  usdPerMillionTokens: usd(0.734),
  usdPerMillionOutputTokens: usd(2.9),
  saturatedTokensPerSec: 41000,
}

const LAUNCH = [
  'vllm serve deepseek-ai/DeepSeek-V3.2 \\',
  '  --tensor-parallel-size 8 --max-model-len 131072 \\',
  '  --gpu-memory-utilization 0.90 --enable-prefix-caching',
].join('\n')

const DEPLOYMENT: Deployment = {
  acceleratorId: 'h200',
  accelerator: ACCEL,
  quant: 'fp8',
  parallelism: PARALLELISM,
  replicas: 1,
  totalGpus: 8,
  totalNodes: 1,
  memory: MEMORY,
  performance: PERFORMANCE,
  cost: COST,
  warnings: [],
  framework: 'vllm',
  launchCommand: LAUNCH,
  hostRamGib: 2256,
  diskGib: 455,
}

const DERIVED: DerivedLoad = {
  peakRps: 9.3,
  concurrentSeqs: 112,
  decodeTokensPerSecNeeded: 7440,
  prefillTokensPerSecNeeded: 111600,
  avgSeqLen: 12800,
}

const WORKLOAD: Workload = {
  profileId: 'coding-agent',
  dau: 500,
  requestsPerUserPerDay: 40,
  promptTokens: 12000,
  outputTokens: 800,
  peakFactor: 4,
  prefixCacheHitRate: 0.7,
  slaTokensPerSec: 25,
  slaTtftSeconds: 4,
  maxContext: 131072,
  speculative: false,
  gpuMemUtil: 0.9,
  kvQuant: 'fp8',
}

const figure = (container: HTMLElement, name: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(`[data-figure="${name}"]`)
  if (!el) throw new Error(`no figure "${name}" rendered`)
  return el
}

const widthsOf = (container: HTMLElement, selector: string): number[] =>
  Array.from(container.querySelectorAll<HTMLElement>(selector)).map((el) =>
    Number.parseFloat(el.style.width),
  )

/* ------------------------------------------------------------------ */

describe('format contract used by the results components', () => {
  it('formatRange renders a ±25% band, never a bare point value', () => {
    const text = formatRange(41, 'tok/s', 'en')

    expect(text).toContain(EN_DASH)
    expect(text).not.toBe('41 tok/s')

    const [low, high] = text.replace(' tok/s', '').split(EN_DASH).map(Number)
    expect(low).toBeLessThan(41)
    expect(high).toBeGreaterThan(41)
    // The band is at least as wide as the model's own ±25%.
    expect(low).toBeLessThanOrEqual(41 * 0.75)
    expect(high).toBeGreaterThanOrEqual(41 * 1.25)
  })
})

describe('LoadSummary', () => {
  it('shows peak RPS, concurrent sessions and the decode/prefill demand', () => {
    const { container } = render(<LoadSummary derived={DERIVED} />)

    expect(figure(container, 'peakRps')).toHaveTextContent('9.3')
    expect(figure(container, 'concurrentSeqs')).toHaveTextContent('112')
    expect(figure(container, 'decodeNeeded')).toHaveTextContent('7,440')
    expect(figure(container, 'prefillNeeded')).toHaveTextContent('111,600')
    expect(screen.getByText(en.load.title)).toBeInTheDocument()
  })
})

describe('MemoryBar', () => {
  it('MemoryBar segments sum to 100% of the bar width', () => {
    const { container } = render(<MemoryBar memory={MEMORY} />)

    const widths = widthsOf(container, '[data-segment]')
    expect(widths).toHaveLength(4)
    expect(widths.every((w) => Number.isFinite(w) && w >= 0)).toBe(true)
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
  })

  it('sizes each segment against usable memory, not against total HBM', () => {
    const { container } = render(<MemoryBar memory={MEMORY} />)

    const weights = container.querySelector<HTMLElement>('[data-segment="weights"]')!
    // 42 of 126.9 usable GiB, not 42 of 141 installed.
    expect(Number.parseFloat(weights.style.width)).toBeCloseTo((42 / 126.9) * 100, 3)
  })

  it('still sums to 100% when the breakdown is degenerate', () => {
    const broken: MemoryBreakdown = {
      ...MEMORY,
      weightsPerGpu: bytes(Number.NaN),
      kvPerGpu: bytes(0),
      overheadPerGpu: bytes(0),
      availablePerGpu: bytes(0),
    }
    const { container } = render(<MemoryBar memory={broken} />)

    const widths = widthsOf(container, '[data-segment]')
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/)
  })

  it('carries accessible text naming every segment and its size', () => {
    const { container } = render(<MemoryBar memory={MEMORY} />)

    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain(
      fill(en.memoryBar.legend, {
        weights: '42 GiB',
        kv: '76 GiB',
        overhead: '8.9 GiB',
        free: '0 GiB',
      }),
    )
    expect(label).toContain(fill(en.memoryBar.outOf, { total: '127 GiB' }))

    // The relief rule: light-mode aqua is below 3:1, so every segment must also
    // carry a visible direct label rather than relying on its fill colour.
    const legend = container.textContent ?? ''
    expect(legend).toContain(en.memoryBar.segment.weights)
    expect(legend).toContain(en.memoryBar.segment.kv)
    expect(legend).toContain(en.memoryBar.segment.overhead)
    expect(legend).toContain(en.memoryBar.segment.free)
  })
})

describe('DeploymentCard', () => {
  it('DeploymentCard collapsed shows gpus, $/1M tok, per-user tps and TTFT', () => {
    const { container } = render(<DeploymentCard deployment={DEPLOYMENT} />)

    expect(figure(container, 'totalGpus')).toHaveTextContent('8')
    expect(figure(container, 'perUserTps')).toHaveTextContent(`30${EN_DASH}52 tok/s`)
    expect(figure(container, 'ttft')).toHaveTextContent(`1.3${EN_DASH}2.3 s`)

    const price = figure(container, 'pricePerMOutput')
    expect(price).toHaveTextContent(`$2.1${EN_DASH}3.7`)
    expect(price).toHaveTextContent(en.card.pricePerMOutput)

    // The headline price is the output-only figure; the blended one is not
    // allowed to sit in the collapsed card at all.
    expect(container.querySelector('[data-figure="pricePerMBlended"]')).toBeNull()
    expect(container.textContent).not.toContain(en.card.pricePerMBlended)

    expect(screen.getByText(/NVIDIA H200 141GB/)).toBeInTheDocument()
    expect(container.querySelector('[data-segment="weights"]')).not.toBeNull()
  })

  it('renders exact counts as points and modelled figures as bands', () => {
    const { container } = render(<DeploymentCard deployment={DEPLOYMENT} />)

    // A GPU count is exact: no band, ever.
    expect(figure(container, 'totalGpus').textContent).not.toContain(EN_DASH)
    expect(figure(container, 'perUserTps').textContent).toContain(EN_DASH)
    expect(figure(container, 'ttft').textContent).toContain(EN_DASH)
    expect(figure(container, 'pricePerMOutput').textContent).toContain(EN_DASH)
  })

  it('DeploymentCard expanded reveals the launch command', () => {
    const { container } = render(<DeploymentCard deployment={DEPLOYMENT} />)

    expect(container.querySelector('pre')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.card.expand }))

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('--tensor-parallel-size 8')
    expect(screen.getByRole('button', { name: en.actions.copy })).toBeInTheDocument()
  })

  it('a multi-GPU replica needing no network fabric still names its intra-node fabric', () => {
    // requiredInterconnect === null means "no NETWORK fabric", not "no interconnect".
    // Telling someone eight NVLinked cards need nothing would imply they can be split
    // across machines.
    render(
      <DeploymentCard
        deployment={{
          ...DEPLOYMENT,
          parallelism: { ...PARALLELISM, requiredInterconnect: null },
        }}
        defaultExpanded
      />,
    )
    expect(screen.queryByText(en.card.interconnectNone)).toBeNull()
    expect(
      screen.getByText(
        fill(en.card.interconnectIntraNode, { fabric: en.enums.interconnect.nvlink }),
      ),
    ).toBeInTheDocument()
  })

  it('a single-GPU replica genuinely needs no interconnect', () => {
    render(
      <DeploymentCard
        deployment={{
          ...DEPLOYMENT,
          parallelism: {
            ...PARALLELISM,
            tp: 1,
            ep: 1,
            gpusPerReplica: 1,
            requiredInterconnect: null,
          },
        }}
        defaultExpanded
      />,
    )
    expect(screen.getByText(en.card.interconnectNone)).toBeInTheDocument()
  })

  it('expanded adds parallelism, interconnect, host sizing, utilization and the blended price', () => {
    const { container } = render(<DeploymentCard deployment={DEPLOYMENT} defaultExpanded />)

    expect(screen.getByText(en.card.interconnect)).toBeInTheDocument()
    expect(screen.getByText(en.enums.interconnect.nvlink)).toBeInTheDocument()
    expect(screen.getByText(en.card.hostRam)).toBeInTheDocument()
    expect(screen.getByText(en.card.disk)).toBeInTheDocument()

    const meter = widthsOf(container, '[data-utilization]')
    expect(meter).toHaveLength(3)
    expect(meter.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)

    // Both price figures are present and each carries its own disambiguation.
    const blended = figure(container, 'pricePerMBlended')
    expect(blended).toHaveTextContent(en.card.pricePerMBlended)
    expect(screen.getByText(en.card.pricePerMBlendedNote)).toBeInTheDocument()
    expect(screen.getByText(en.card.pricePerMOutputNote)).toBeInTheDocument()
  })

  it('a warned deployment renders its warning text', () => {
    const warned: Deployment = {
      ...DEPLOYMENT,
      warnings: [
        { kind: 'slaTps', detail: '21 tok/s against an SLA of 25', missPercent: 0.16 },
        { kind: 'degradedInterconnect', detail: 'TP across nodes over IB 400G' },
      ],
    }
    const { container } = render(<DeploymentCard deployment={warned} />)

    expect(
      screen.getByText(fill(en.warning.slaTps, { miss: '16%' })),
    ).toBeInTheDocument()
    expect(screen.getByText(en.warning.degradedInterconnect)).toBeInTheDocument()

    // Prominent, not a footnote: the warnings sit in the collapsed card.
    expect(container.querySelectorAll('[data-warning]')).toHaveLength(2)
  })

  it('renders an em dash instead of a price when nothing is priced', () => {
    const unpriced: Deployment = {
      ...DEPLOYMENT,
      cost: {
        ...COST,
        capex: null,
        hourlyRent: null,
        hourlyPower: null,
        tco3y: null,
        usdPerMillionTokens: null,
        usdPerMillionOutputTokens: null,
      },
    }
    const { container } = render(<DeploymentCard deployment={unpriced} defaultExpanded />)

    expect(figure(container, 'pricePerMOutput')).toHaveTextContent('—')
    expect(container.textContent).not.toMatch(/NaN|Infinity|\$null/)
    expect(screen.getByText(en.card.costUnavailable)).toBeInTheDocument()
  })
})

describe('RejectedTable', () => {
  const REJECTIONS: Rejection[] = [
    {
      acceleratorId: 'h100',
      quant: 'bf16',
      parallelism: { ...PARALLELISM, tp: 4, ep: 4, gpusPerReplica: 4 },
      replicas: 1,
      reason: 'oom',
      detail: 'weights plus one sequence exceed usable HBM',
      deficitBytes: gib(218),
    },
    {
      acceleratorId: 'rtx5090',
      quant: 'int4',
      parallelism: { ...PARALLELISM, requiredInterconnect: 'pcie' },
      replicas: 1,
      reason: 'slaTps',
      detail: '11 tok/s against an SLA of 25',
      actual: 11,
      required: 25,
    },
    {
      acceleratorId: 'h100',
      quant: 'fp8',
      parallelism: { ...PARALLELISM, nodesPerReplica: 2, gpusPerReplica: 16 },
      replicas: 1,
      reason: 'interconnect',
      detail: 'tensor parallel over Ethernet',
    },
  ]

  it('RejectedTable renders one row per rejection with reason and detail', () => {
    render(<RejectedTable rejections={REJECTIONS} accelerators={[ACCEL]} />)

    const rows = screen.getAllByRole('row').slice(1) // drop the header row
    expect(rows).toHaveLength(3)

    expect(within(rows[0]).getByText(en.rejection.reason.oom)).toBeInTheDocument()
    expect(
      within(rows[0]).getByText(/weights plus one sequence exceed usable HBM/),
    ).toBeInTheDocument()
    expect(within(rows[1]).getByText(en.rejection.reason.slaTps)).toBeInTheDocument()
    expect(within(rows[2]).getByText(en.rejection.reason.interconnect)).toBeInTheDocument()

    expect(screen.getByText(en.rejection.colConfig)).toBeInTheDocument()
    expect(screen.getByText(en.rejection.colReason)).toBeInTheDocument()
    expect(screen.getByText(en.rejection.colDetail)).toBeInTheDocument()
  })

  it('an oom rejection shows the deficit in GiB', () => {
    render(<RejectedTable rejections={REJECTIONS} accelerators={[ACCEL]} />)

    expect(
      screen.getByText(fill(en.rejection.deficit, { gib: '218 GiB' })),
    ).toBeInTheDocument()
  })

  it('names the configuration and resolves the accelerator display name', () => {
    render(<RejectedTable rejections={REJECTIONS} accelerators={[ACCEL]} />)

    const rows = screen.getAllByRole('row').slice(1)
    // Unknown ids fall back to the raw id rather than rendering a hole.
    expect(rows[0].textContent).toContain('h100')
    expect(rows[0].textContent).toContain(en.enums.quant.bf16)
    expect(rows[0].textContent).toContain('TP=4')
  })

  it('caps the table and offers to show the rest', () => {
    const many: Rejection[] = Array.from({ length: 8 }, (_, i) => ({
      ...REJECTIONS[1],
      detail: `candidate ${i}`,
    }))
    render(<RejectedTable rejections={many} maxRows={3} />)

    expect(screen.getAllByRole('row').slice(1)).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: en.actions.showAll }))
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(8)
  })

  it('renders nothing when there is nothing to explain', () => {
    const { container } = render(<RejectedTable rejections={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('HowComputed', () => {
  it("HowComputed substitutes the user's actual numbers into the formulas", () => {
    const { container } = render(
      <HowComputed
        model={MODEL}
        workload={WORKLOAD}
        derived={DERIVED}
        deployment={DEPLOYMENT}
      />,
    )
    const text = container.textContent ?? ''

    // The symbolic formula is shown …
    expect(container.querySelectorAll('pre').length).toBeGreaterThan(4)
    expect(text).toContain('maxConcurrentSeqs = kvBudget / (kvBytesPerTok × avgSeqLen)')

    // … and beside it, this user's own numbers.
    expect(text).toContain('42 GiB') // weightsPerGpu
    expect(text).toContain('8.9 GiB') // overheadPerGpu
    // 126.9 GiB, on `formatGib`'s rounding grid (no decimals at or above 10).
    expect(text).toContain('127 GiB') // availablePerGpu
    expect(text).toContain('141 GiB') // installed HBM the budget came from
    expect(text).toContain('512') // maxConcurrentSeqs
    expect(text).toContain('12,800') // avgSeqLen
    expect(text).toContain('90%') // gpuMemUtil
    expect(text).toContain('70%') // MBU for nvidia-hopper-blackwell
    expect(text).toContain('45%') // MFU for nvidia-hopper-blackwell
    expect(text).toContain(en.enums.kvQuant.fp8)
    expect(text).toContain(en.enums.framework.vllm)
  })

  it('bands the modelled quantities and points the exact ones', () => {
    const { container } = render(
      <HowComputed
        model={MODEL}
        workload={WORKLOAD}
        derived={DERIVED}
        deployment={DEPLOYMENT}
      />,
    )

    expect(figure(container, 'perUserTps').textContent).toContain(EN_DASH)
    expect(figure(container, 'saturatedTokensPerSec').textContent).toContain(EN_DASH)
    expect(figure(container, 'maxConcurrentSeqs').textContent).not.toContain(EN_DASH)
    expect(figure(container, 'totalGpus').textContent).not.toContain(EN_DASH)
  })

  it('cites the model config.json it took the hyperparameters from', () => {
    render(
      <HowComputed
        model={MODEL}
        workload={WORKLOAD}
        derived={DERIVED}
        deployment={DEPLOYMENT}
      />,
    )

    const link = screen.getByRole('link', { name: en.card.modelSource })
    expect(link).toHaveAttribute('href', MODEL.sourceUrl)
  })

  it('never leaks a non-finite number into the page', () => {
    const degenerate: Deployment = {
      ...DEPLOYMENT,
      performance: {
        ...PERFORMANCE,
        perUserTps: tokensPerSec(Number.NaN),
        ttft: seconds(Number.POSITIVE_INFINITY),
      },
      cost: { ...COST, usdPerMillionOutputTokens: null, saturatedTokensPerSec: Number.NaN },
    }
    const { container } = render(
      <HowComputed
        model={MODEL}
        workload={WORKLOAD}
        derived={DERIVED}
        deployment={degenerate}
      />,
    )

    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined|null/)
  })
})
