import type {
  AcceleratorSpec,
  Interconnect,
  ModelSpec,
  Parallelism,
  RejectionReason,
} from './types'

/**
 * Result of an interconnect legality check (spec 3.4).
 *
 * Discriminated on `ok`. An accepted-but-compromised topology returns
 * `{ ok: true, degraded: <reason> }`; the UI surfaces it as a warning.
 */
export type InterconnectCheck =
  | { ok: true; degraded?: string }
  | { ok: false; reason: RejectionReason; detail: string }

/** Intra-node fabrics fast enough to carry a tensor-parallel all-reduce. */
const TP_FABRICS: ReadonlySet<Interconnect> = new Set<Interconnect>(['nvlink', 'xgmi', 'hccs'])

/** Pipeline-parallel degrees considered by the enumerator. */
const PP_CANDIDATES = [1, 2, 4, 8] as const

/** In-flight microbatches assumed for the pipeline bubble estimate. */
export const DEFAULT_MICROBATCHES = 8

/**
 * Pipeline bubble penalty (spec 3.4): `(pp - 1) / (microbatches + pp - 1)`.
 * A fraction of pipeline time lost to fill/drain; zero without pipelining.
 */
export function bubblePenalty(pp: number, microbatches: number): number {
  if (!Number.isFinite(pp) || pp <= 1) return 0
  const denom = microbatches + pp - 1
  if (!Number.isFinite(denom) || denom <= 0) return 0
  return (pp - 1) / denom
}

/**
 * Legal `(tp, pp, ep)` tuples for a model on a given accelerator (spec 3.4).
 *
 * - TP is a power of two, capped by GPUs per node and by attention heads.
 * - PP must divide the layer count evenly.
 * - `tp * pp` must fit inside `maxGpus`.
 * - Unified-memory hosts (Mac Studio, CPU) are single-device: TP=1, PP=1 only.
 */
export function enumerateParallelism(
  model: ModelSpec,
  accel: AcceleratorSpec,
  maxGpus: number,
): Parallelism[] {
  const single: Parallelism = {
    tp: 1,
    pp: 1,
    ep: 1,
    gpusPerReplica: 1,
    nodesPerReplica: 1,
    requiredInterconnect: null,
    bubblePenalty: 0,
  }

  if (accel.intraNode === 'unified-memory') return [single]
  if (!Number.isFinite(maxGpus) || maxGpus < 1) return []

  const perNode = Math.max(1, Math.floor(accel.maxPerNode))
  const tpCap = Math.max(1, Math.min(perNode, model.attention.heads))

  const tpCandidates: number[] = []
  for (let tp = 1; tp <= tpCap; tp *= 2) tpCandidates.push(tp)

  const ppCandidates = PP_CANDIDATES.filter((pp) => pp === 1 || model.layers % pp === 0)

  const out: Parallelism[] = []
  for (const tp of tpCandidates) {
    for (const pp of ppCandidates) {
      const gpusPerReplica = tp * pp
      if (gpusPerReplica > maxGpus) continue
      const nodesPerReplica = Math.ceil(gpusPerReplica / perNode)
      out.push({
        tp,
        pp,
        ep: model.moe && gpusPerReplica >= 8 ? gpusPerReplica : 1,
        gpusPerReplica,
        nodesPerReplica,
        requiredInterconnect: nodesPerReplica > 1 ? 'ib400' : null,
        bubblePenalty: bubblePenalty(pp, DEFAULT_MICROBATCHES),
      })
    }
  }

  out.sort((a, b) => a.gpusPerReplica - b.gpusPerReplica || a.tp - b.tp || a.pp - b.pp)
  return out
}

/**
 * Interconnect legality (spec 3.4).
 *
 * TP stays inside a node over NVLink / xGMI / HCCS. A TP group that spans nodes
 * is only tolerable on IB >= 400 Gb/s and is flagged as degraded; on PCIe or
 * Ethernet it is rejected outright. PP across nodes moves only activations and
 * is fine on commodity networking.
 */
export function checkInterconnect(par: Parallelism, accel: AcceleratorSpec): InterconnectCheck {
  if (par.nodesPerReplica <= 1) return { ok: true }

  const perNode = Math.max(1, Math.floor(accel.maxPerNode))
  if (par.tp > perNode) {
    if (TP_FABRICS.has(accel.intraNode)) {
      return {
        ok: true,
        degraded: `TP=${par.tp} spans ${par.nodesPerReplica} nodes; needs IB >= 400 Gb/s`,
      }
    }
    return {
      ok: false,
      reason: 'interconnect',
      detail:
        `TP=${par.tp} spans ${par.nodesPerReplica} nodes over ${accel.intraNode}; ` +
        `tensor parallelism requires NVLink/xGMI/HCCS inside the node or IB >= 400 Gb/s`,
    }
  }

  return { ok: true }
}
