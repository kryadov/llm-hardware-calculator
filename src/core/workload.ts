import type { DerivedLoad, LoadProfile, Workload } from './types'

const SECONDS_PER_DAY = 86400

/** Default fraction of HBM vLLM is allowed to claim. */
const DEFAULT_GPU_MEM_UTIL = 0.9

/**
 * Turn a catalogue load profile into a full {@link Workload} by attaching the
 * user-controlled knobs (DAU, context ceiling) and the advanced defaults.
 */
export function workloadFromProfile(
  profile: LoadProfile,
  dau: number,
  maxContext: number,
): Workload {
  return {
    profileId: profile.id,
    dau,
    requestsPerUserPerDay: profile.requestsPerUserPerDay,
    promptTokens: profile.promptTokens,
    outputTokens: profile.outputTokens,
    peakFactor: profile.peakFactor,
    prefixCacheHitRate: profile.prefixCacheHitRate,
    slaTokensPerSec: profile.slaTokensPerSec,
    slaTtftSeconds: profile.slaTtftSeconds,
    maxContext,
    speculative: false,
    gpuMemUtil: DEFAULT_GPU_MEM_UTIL,
    kvQuant: 'fp16',
  }
}

/**
 * Derive peak traffic figures from a workload.
 *
 * Concurrency follows Little's law: the number of sequences in flight is the
 * arrival rate times the time each request holds a decoding slot, and that hold
 * time is the output length divided by the per-user tokens/s SLA.
 */
export function deriveLoad(w: Workload): DerivedLoad {
  const peakRps = (w.dau * w.requestsPerUserPerDay) / SECONDS_PER_DAY * w.peakFactor
  const avgSeqLen = Math.min(w.promptTokens + w.outputTokens, w.maxContext)
  const holdTime = w.outputTokens / w.slaTokensPerSec
  const concurrentSeqs = Math.max(1, Math.ceil(peakRps * holdTime))
  const prefillTokensPerSecNeeded = peakRps * w.promptTokens
  const decodeTokensPerSecNeeded = peakRps * w.outputTokens

  return {
    peakRps,
    concurrentSeqs,
    decodeTokensPerSecNeeded,
    prefillTokensPerSecNeeded,
    avgSeqLen,
  }
}
