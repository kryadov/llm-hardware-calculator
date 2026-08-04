/**
 * Candidate solver — spec §2 ("Отвергнутые кандидаты — часть результата",
 * "Режим Verify — тот же solver с закреплённым кандидатом") and §3.6 (ранжирование).
 *
 * One entry point, two inputs. Explore enumerates
 * `accelerator × quantization × parallelism`; Verify pins an accelerator, a GPU
 * count and a quantization and evaluates only the ways that fleet can be split.
 * Both paths run the identical evaluation and ranking code, so a pinned candidate
 * always agrees with the explore candidate that describes the same hardware.
 *
 * Every candidate that does not survive is returned with a machine-readable
 * {@link RejectionReason} and a human-readable detail: explaining *why* a cheaper
 * option is impossible is half the value of the tool.
 */
import { COEFFICIENTS, PRICING } from '../data'
import type { CoefficientTable, PricingTable } from '../data/schema'
import { computeCost } from './cost'
import { launchCommand } from './launch'
import { computeMemory, weightBytes } from './memory'
import { checkInterconnect, enumerateParallelism } from './parallelism'
import { computePerformance, replicasNeeded } from './throughput'
import type {
  AcceleratorSpec,
  CostMode,
  Deployment,
  Framework,
  MemoryBreakdown,
  ModelSpec,
  Parallelism,
  Performance,
  Quant,
  Rejection,
  RejectionReason,
  SolveResult,
  Warning,
  Workload,
} from './types'
import { toGib } from './units'
import { deriveLoad } from './workload'

/**
 * Spec §3.2: a candidate that misses `perUserTps` or `TTFT` by up to 20% stays in
 * the main list carrying a warning; beyond that it is rejected. The threshold
 * exists because the model itself is only accurate to ±25% — hiding a candidate
 * that missed by 10% would be false precision.
 */
export const SLA_TOLERANCE = 0.2

/** Quantizations explored when the caller does not narrow the search. */
export const DEFAULT_QUANTS: readonly Quant[] = ['bf16', 'fp8', 'int8', 'int4']

/** Ceiling on GPUs inside one model replica (TP × PP) during Explore. */
export const DEFAULT_MAX_GPUS_PER_REPLICA = 64

/** Spec §4: the results feed shows a handful of options, not a spreadsheet. */
export const MAX_DEPLOYMENTS = 8

/** Rejections are a diagnostic block, capped so the UI stays readable. */
export const MAX_REJECTIONS = 60

/** Used when an accelerator names a coefficient family the table does not carry. */
const FALLBACK_COEFFICIENTS = { mbu: 0.5, mfu: 0.25 }

/** Weights on disk carry tokenizer, index and safetensors padding on top. */
const DISK_OVERHEAD_FACTOR = 1.3

/** Rule of thumb: host RAM sized at 2× the aggregate HBM of one node. */
const HOST_RAM_PER_HBM = 2

export interface SolvePin {
  acceleratorId: string
  /** Size of the fleet the user already owns, in accelerators. */
  totalGpus: number
  quant: Quant
}

export interface SolveArgs {
  model: ModelSpec
  workload: Workload
  accelerators: AcceleratorSpec[]
  quants?: Quant[]
  costMode: CostMode
  /** Verify mode: evaluate only this hardware, at this exact GPU count. */
  pin?: SolvePin
  /** Explore-mode ceiling on TP × PP. Defaults to {@link DEFAULT_MAX_GPUS_PER_REPLICA}. */
  maxGpusPerReplica?: number
  /** Preferred serving framework; ignored when the accelerator does not support it. */
  framework?: Framework
  pricing?: PricingTable
  coefficients?: CoefficientTable
}

/** Ordering of rejection reasons in the diagnostic block: near misses first. */
const REASON_RANK: Record<RejectionReason, number> = {
  slaTps: 0,
  slaTtft: 0,
  oom: 1,
  interconnect: 2,
  nodeLimit: 3,
  tpNotDivisible: 3,
  unsupportedQuant: 4,
  contextTooLong: 5,
  internal: 6,
}

interface ScoredRejection {
  rejection: Rejection
  /** Lower is a nearer miss. */
  nearness: number
}

const finite = (n: number): boolean => Number.isFinite(n)

/** Picks the framework actually used for the launch command. */
function pickFramework(accel: AcceleratorSpec, requested?: Framework): Framework {
  if (requested && accel.frameworks.includes(requested)) return requested
  return accel.frameworks[0] ?? 'vllm'
}

/**
 * Spec §3.3: MBU/MFU come from the coefficient table keyed by hardware family,
 * never from a constant in the formulas.
 */
function coefficientsFor(
  accel: AcceleratorSpec,
  table: CoefficientTable,
): { mbu: number; mfu: number } {
  const row = table.families[accel.coefficientFamily]
  if (!row || !finite(row.mbu) || !finite(row.mfu) || row.mbu <= 0 || row.mfu <= 0) {
    return FALLBACK_COEFFICIENTS
  }
  return { mbu: row.mbu, mfu: row.mfu }
}

/**
 * FP8 needs a native FP8 datapath: on Ampere and on the CPU/Apple hosts there is
 * none, so the checkpoint would have to be up-converted and the quantization buys
 * nothing. INT8/INT4 are weight-only formats that dequantize into the compute
 * dtype, so they run anywhere — `peakFlopsFor` already falls back to BF16.
 */
function quantSupported(accel: AcceleratorSpec, quant: Quant): boolean {
  if (quant !== 'fp8') return true
  return accel.peakTflops.fp8 !== null
}

/** The sort key for the user's chosen cost mode (spec §3.6). */
function rankKey(d: Deployment, mode: CostMode): number {
  if (mode === 'rent') {
    return (d.cost.usdPerMillionTokens as number | null) ?? Number.POSITIVE_INFINITY
  }
  if (mode === 'buy') {
    return (d.cost.tco3y as number | null) ?? Number.POSITIVE_INFINITY
  }
  return d.totalGpus
}

/**
 * Spec §3.6. Warned candidates always come after clean ones regardless of the
 * primary key; ties fall back to fewer GPUs, then to a faster per-user experience,
 * then to the candidate identity so the order is fully deterministic.
 */
function compareDeployments(a: Deployment, b: Deployment, mode: CostMode): number {
  const wa = a.warnings.length > 0 ? 1 : 0
  const wb = b.warnings.length > 0 ? 1 : 0
  if (wa !== wb) return wa - wb

  const ka = rankKey(a, mode)
  const kb = rankKey(b, mode)
  if (ka !== kb) return ka < kb ? -1 : 1

  if (a.totalGpus !== b.totalGpus) return a.totalGpus - b.totalGpus

  const ta = a.performance.perUserTps as number
  const tb = b.performance.perUserTps as number
  if (ta !== tb) return tb - ta

  if (a.acceleratorId !== b.acceleratorId) return a.acceleratorId < b.acceleratorId ? -1 : 1
  if (a.quant !== b.quant) return a.quant < b.quant ? -1 : 1
  if (a.parallelism.tp !== b.parallelism.tp) return a.parallelism.tp - b.parallelism.tp
  return a.parallelism.pp - b.parallelism.pp
}

/** Builds a rejection, filling the shared identity fields. */
function reject(
  accel: AcceleratorSpec,
  quant: Quant,
  par: Parallelism,
  replicas: number,
  reason: RejectionReason,
  detail: string,
  extra: Partial<Rejection> = {},
): Rejection {
  return {
    acceleratorId: accel.id,
    quant,
    parallelism: par,
    replicas: finite(replicas) && replicas > 0 ? replicas : 1,
    reason,
    detail,
    ...extra,
  }
}

interface EvaluateArgs {
  model: ModelSpec
  workload: Workload
  accel: AcceleratorSpec
  quant: Quant
  par: Parallelism
  derived: ReturnType<typeof deriveLoad>
  costMode: CostMode
  pricing: PricingTable
  coefficients: CoefficientTable
  framework?: Framework
  /** Verify mode: the replica count is dictated by the pinned fleet, not by the load. */
  forcedReplicas: number | null
}

/**
 * Evaluates one `accelerator × quant × parallelism` candidate all the way to a
 * `Deployment`, or to the first rule that rules it out.
 */
function evaluate(args: EvaluateArgs): Deployment | Rejection {
  const {
    model,
    workload,
    accel,
    quant,
    par,
    derived,
    costMode,
    pricing,
    coefficients,
    forcedReplicas,
  } = args
  const fallbackReplicas = forcedReplicas ?? 1

  /* --- Hard capability checks -------------------------------------- */
  if (workload.maxContext > model.maxContext) {
    return reject(
      accel,
      quant,
      par,
      fallbackReplicas,
      'contextTooLong',
      `requested context ${workload.maxContext} exceeds the ${model.maxContext}-token ` +
        `limit of ${model.displayName}`,
      { actual: workload.maxContext, required: model.maxContext },
    )
  }

  if (!quantSupported(accel, quant)) {
    return reject(
      accel,
      quant,
      par,
      fallbackReplicas,
      'unsupportedQuant',
      `${accel.displayName} has no native FP8 datapath, so an FP8 checkpoint gains nothing`,
    )
  }

  /* --- Interconnect legality (spec §3.4) ---------------------------- */
  const ic = checkInterconnect(par, accel)
  if (!ic.ok) {
    return reject(accel, quant, par, fallbackReplicas, ic.reason, ic.detail)
  }

  /* --- Memory (spec §3.1) ------------------------------------------- */
  const mem = computeMemory({
    model,
    accel,
    quant,
    kvQuant: workload.kvQuant,
    par,
    avgSeqLen: derived.avgSeqLen,
    gpuMemUtil: workload.gpuMemUtil,
  })
  if ('error' in mem) {
    const deficitGib = toGib(mem.deficitBytes)
    return reject(
      accel,
      quant,
      par,
      fallbackReplicas,
      'oom',
      `${quant} weights plus one sequence of KV cache do not fit on ` +
        `${par.gpusPerReplica}× ${accel.displayName}: short by ${deficitGib.toFixed(1)} GiB ` +
        `across the replica`,
      { deficitBytes: mem.deficitBytes },
    )
  }
  const memory: MemoryBreakdown = mem

  /* --- Throughput (spec §3.2) --------------------------------------- */
  const { mbu, mfu } = coefficientsFor(accel, coefficients)
  const perf: Performance | null = computePerformance({
    model,
    accel,
    quant,
    par,
    mem: memory,
    w: workload,
    derived,
    mbu,
    mfu,
  })
  if (perf === null) {
    return reject(
      accel,
      quant,
      par,
      fallbackReplicas,
      'internal',
      `the throughput model produced a degenerate result for ${accel.displayName} at ` +
        `TP=${par.tp} PP=${par.pp}; the candidate was dropped rather than reported as NaN`,
    )
  }

  /* --- Replicas ------------------------------------------------------ */
  const needed = replicasNeeded(perf)
  const replicas = forcedReplicas ?? needed
  if (!finite(replicas) || replicas < 1) {
    return reject(
      accel,
      quant,
      par,
      1,
      'internal',
      `replica count for ${accel.displayName} at TP=${par.tp} PP=${par.pp} is not a positive number`,
    )
  }

  if (forcedReplicas !== null && forcedReplicas < needed) {
    return reject(
      accel,
      quant,
      par,
      forcedReplicas,
      'slaTps',
      `the pinned fleet runs ${forcedReplicas} replica(s) of ${par.gpusPerReplica}× ` +
        `${accel.displayName}; this load needs ${needed} to stay under 80% utilization`,
      { actual: forcedReplicas, required: needed },
    )
  }

  const totalGpus = par.gpusPerReplica * replicas
  const totalNodes = par.nodesPerReplica * replicas

  /* --- SLA (spec §3.2) ----------------------------------------------- */
  const perUserTps = perf.perUserTps as number
  const ttft = perf.ttft as number
  const tpsMiss =
    workload.slaTokensPerSec > 0
      ? (workload.slaTokensPerSec - perUserTps) / workload.slaTokensPerSec
      : 0
  const ttftMiss =
    workload.slaTtftSeconds > 0 ? (ttft - workload.slaTtftSeconds) / workload.slaTtftSeconds : 0

  if (tpsMiss > SLA_TOLERANCE) {
    return reject(
      accel,
      quant,
      par,
      replicas,
      'slaTps',
      `${perUserTps.toFixed(1)} tok/s per user against an SLA of ` +
        `${workload.slaTokensPerSec.toFixed(1)} tok/s — a ${(tpsMiss * 100).toFixed(0)}% miss`,
      { actual: perUserTps, required: workload.slaTokensPerSec },
    )
  }
  if (ttftMiss > SLA_TOLERANCE) {
    return reject(
      accel,
      quant,
      par,
      replicas,
      'slaTtft',
      `time to first token ${ttft.toFixed(2)} s against an SLA of ` +
        `${workload.slaTtftSeconds.toFixed(2)} s — a ${(ttftMiss * 100).toFixed(0)}% miss`,
      { actual: ttft, required: workload.slaTtftSeconds },
    )
  }

  /* --- Warnings ------------------------------------------------------- */
  const warnings: Warning[] = []
  if (tpsMiss > 0) {
    warnings.push({
      kind: 'slaTps',
      detail:
        `${perUserTps.toFixed(1)} tok/s per user, ${(tpsMiss * 100).toFixed(0)}% under the ` +
        `${workload.slaTokensPerSec.toFixed(1)} tok/s target`,
      missPercent: tpsMiss * 100,
    })
  }
  if (ttftMiss > 0) {
    warnings.push({
      kind: 'slaTtft',
      detail:
        `TTFT ${ttft.toFixed(2)} s, ${(ttftMiss * 100).toFixed(0)}% over the ` +
        `${workload.slaTtftSeconds.toFixed(2)} s target`,
      missPercent: ttftMiss * 100,
    })
  }
  if (ic.ok && ic.degraded) {
    warnings.push({ kind: 'degradedInterconnect', detail: ic.degraded })
  }
  if (accel.coefficientFamily === 'chinese-accelerator') {
    warnings.push({
      kind: 'immatureStack',
      detail:
        `${accel.displayName} runs an immature kernel stack against vendor-claimed peak ` +
        `figures; the MBU/MFU coefficients used here are correspondingly conservative`,
    })
  }

  /* --- Cost (spec §3.5) ----------------------------------------------- */
  const cost = computeCost({
    accel,
    totalGpus,
    totalNodes,
    replicas,
    perf,
    derived,
    pricing,
    mode: costMode,
  })

  /* --- Sizing the host ------------------------------------------------ */
  const gpusPerNode = Math.max(1, Math.min(par.gpusPerReplica, accel.maxPerNode))
  const hostRamGib = HOST_RAM_PER_HBM * accel.memoryGib * gpusPerNode
  const diskGib = Math.ceil(toGib(weightBytes(model, quant)) * DISK_OVERHEAD_FACTOR)

  const framework = pickFramework(accel, args.framework)

  return {
    acceleratorId: accel.id,
    accelerator: accel,
    quant,
    parallelism: par,
    replicas,
    totalGpus,
    totalNodes,
    memory,
    performance: perf,
    cost,
    warnings,
    framework,
    launchCommand: launchCommand({
      model,
      par,
      quant,
      kvQuant: workload.kvQuant,
      maxLen: workload.maxContext,
      maxSeqs: memory.maxConcurrentSeqs,
      gpuMemUtil: workload.gpuMemUtil,
      framework,
    }),
    hostRamGib,
    diskGib,
  }
}

/** How near a rejection came to working; lower sorts first. */
function nearness(r: Rejection): number {
  if (r.reason === 'slaTps' && r.actual !== undefined && r.required !== undefined) {
    return r.required > 0 ? (r.required - r.actual) / r.required : 0
  }
  if (r.reason === 'slaTtft' && r.actual !== undefined && r.required !== undefined) {
    return r.required > 0 ? (r.actual - r.required) / r.required : 0
  }
  if (r.reason === 'oom' && r.deficitBytes !== undefined) {
    return r.deficitBytes as number
  }
  return 0
}

/**
 * Explore or Verify, depending on `args.pin`.
 *
 * Returns the derived peak load, the ranked surviving deployments and every
 * rejected candidate with its reason.
 */
export function solve(args: SolveArgs): SolveResult {
  const { model, workload, costMode } = args
  const pricing = args.pricing ?? PRICING
  const coefficients = args.coefficients ?? COEFFICIENTS
  const derived = deriveLoad(workload)

  const pin = args.pin ?? null
  const accelerators = pin
    ? args.accelerators.filter((a) => a.id === pin.acceleratorId)
    : args.accelerators
  const quants = pin ? [pin.quant] : (args.quants ?? [...DEFAULT_QUANTS])
  const maxGpus = pin
    ? Math.max(1, Math.floor(pin.totalGpus))
    : Math.max(1, Math.floor(args.maxGpusPerReplica ?? DEFAULT_MAX_GPUS_PER_REPLICA))

  const deployments: Deployment[] = []
  const rejections: ScoredRejection[] = []

  for (const accel of accelerators) {
    const parallelisms = enumerateParallelism(model, accel, maxGpus)
    let evaluatedForAccel = 0

    for (const quant of quants) {
      for (const par of parallelisms) {
        let forcedReplicas: number | null = null
        if (pin) {
          if (maxGpus % par.gpusPerReplica !== 0) continue
          forcedReplicas = maxGpus / par.gpusPerReplica
        }
        evaluatedForAccel++

        const out = evaluate({
          model,
          workload,
          accel,
          quant,
          par,
          derived,
          costMode,
          pricing,
          coefficients,
          framework: args.framework,
          forcedReplicas,
        })
        if ('reason' in out) rejections.push({ rejection: out, nearness: nearness(out) })
        else deployments.push(out)
      }
    }

    // Verify mode with a fleet size no legal parallelism divides evenly.
    if (pin && evaluatedForAccel === 0) {
      const fallback: Parallelism = {
        tp: 1,
        pp: 1,
        ep: 1,
        gpusPerReplica: 1,
        nodesPerReplica: 1,
        requiredInterconnect: null,
        bubblePenalty: 0,
      }
      rejections.push({
        rejection: reject(
          accel,
          pin.quant,
          fallback,
          1,
          'nodeLimit',
          `no legal TP × PP split of ${model.displayName} divides a fleet of ` +
            `${pin.totalGpus}× ${accel.displayName} evenly`,
        ),
        nearness: 0,
      })
    }
  }

  /* --- Dedupe: one entry per (accelerator, quant) --------------------- */
  const best = new Map<string, Deployment>()
  for (const d of deployments) {
    const key = `${d.acceleratorId}|${d.quant}`
    const current = best.get(key)
    if (!current || compareDeployments(d, current, costMode) < 0) best.set(key, d)
  }

  const ranked = [...best.values()].sort((a, b) => compareDeployments(a, b, costMode))

  const orderedRejections = rejections
    .sort((a, b) => {
      const ra = REASON_RANK[a.rejection.reason]
      const rb = REASON_RANK[b.rejection.reason]
      if (ra !== rb) return ra - rb
      if (a.nearness !== b.nearness) return a.nearness - b.nearness
      return a.rejection.parallelism.gpusPerReplica - b.rejection.parallelism.gpusPerReplica
    })
    .map((x) => x.rejection)

  return {
    derived,
    deployments: ranked.slice(0, pin ? 1 : MAX_DEPLOYMENTS),
    rejections: orderedRejections.slice(0, MAX_REJECTIONS),
  }
}
