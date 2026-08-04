import type { Framework, KvQuant, ModelSpec, Parallelism, Quant } from './types'

/**
 * Launch command generation — spec section 4, "Карточка деплоя".
 *
 * Renders a copy-pasteable `vllm serve` / `sglang.launch_server` invocation for a
 * deployment the solver produced. Every numeric argument is sanitized here so a
 * degenerate candidate can never leak `NaN`/`Infinity` into a string the user runs.
 */

/** Hard bounds so a broken upstream number renders as a plausible flag value. */
const MIN_MEM_UTIL = 0.05
const MAX_MEM_UTIL = 0.98
const DEFAULT_MEM_UTIL = 0.9
const MAX_NUM_SEQS_CAP = 8192

/** vLLM `--quantization` value per weight quantization; `null` = flag omitted. */
const VLLM_QUANTIZATION: Record<Quant, string | null> = {
  bf16: null,
  fp8: 'fp8',
  int8: 'compressed-tensors',
  int4: 'awq',
}

/**
 * KV cache dtype flag value per KV quantization; `null` = flag omitted.
 * Neither vLLM nor SGLang ships an int4 KV dtype, so int4 degrades to fp8 —
 * the closest dtype both runtimes actually accept.
 */
const KV_CACHE_DTYPE: Record<KvQuant, string | null> = {
  fp16: null,
  fp8: 'fp8',
  int4: 'fp8',
}

const isFiniteNumber = (n: number): boolean => typeof n === 'number' && Number.isFinite(n)

const clampInt = (value: number, min: number, max: number, fallback: number): number => {
  const n = isFiniteNumber(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

const clampUtil = (value: number): number => {
  if (!isFiniteNumber(value)) return DEFAULT_MEM_UTIL
  return Math.min(MAX_MEM_UTIL, Math.max(MIN_MEM_UTIL, value))
}

/** A positive integer parallelism degree, defaulting to 1 for anything nonsensical. */
const degree = (value: number): number => clampInt(value, 1, 1024, 1)

/** Joins flags into a shell command with trailing backslash continuations. */
const join = (head: string, flags: string[]): string =>
  [head, ...flags].join(' \\\n  ')

export interface LaunchArgs {
  model: ModelSpec
  par: Parallelism
  quant: Quant
  kvQuant: KvQuant
  maxLen: number
  maxSeqs: number
  gpuMemUtil: number
  framework: Framework
}

/**
 * Builds the launch command for a deployment.
 *
 * The returned string is guaranteed to contain no `NaN`, `undefined` or `null`
 * tokens regardless of how degenerate the inputs are.
 */
export function launchCommand(args: LaunchArgs): string {
  const { model, par, quant, kvQuant, framework } = args

  const repo = model.hfRepo && model.hfRepo.trim().length > 0 ? model.hfRepo.trim() : model.id
  const maxContext = isFiniteNumber(model.maxContext) && model.maxContext >= 1
    ? Math.round(model.maxContext)
    : 4096
  const maxLen = clampInt(args.maxLen, 1, maxContext, maxContext)
  const maxSeqs = clampInt(args.maxSeqs, 1, MAX_NUM_SEQS_CAP, 1)
  const memUtil = clampUtil(args.gpuMemUtil).toFixed(2)
  const tp = degree(par.tp)
  const pp = degree(par.pp)
  const kvDtype = KV_CACHE_DTYPE[kvQuant] ?? null

  if (framework === 'sglang') {
    const flags = [
      `--model-path ${repo}`,
      `--tp ${tp}`,
      ...(pp > 1 ? [`--pp-size ${pp}`] : []),
      `--context-length ${maxLen}`,
      `--mem-fraction-static ${memUtil}`,
      `--max-running-requests ${maxSeqs}`,
      ...(kvDtype ? [`--kv-cache-dtype ${kvDtype}`] : []),
      ...(quant === 'int4' ? ['--quantization awq'] : []),
      ...(quant === 'fp8' ? ['--quantization fp8'] : []),
    ]
    return join('python -m sglang.launch_server', flags)
  }

  const quantization = VLLM_QUANTIZATION[quant] ?? null
  const flags = [
    `--tensor-parallel-size ${tp}`,
    ...(pp > 1 ? [`--pipeline-parallel-size ${pp}`] : []),
    `--max-model-len ${maxLen}`,
    `--gpu-memory-utilization ${memUtil}`,
    `--max-num-seqs ${maxSeqs}`,
    '--enable-prefix-caching',
    ...(kvDtype ? [`--kv-cache-dtype ${kvDtype}`] : []),
    ...(quantization ? [`--quantization ${quantization}`] : []),
  ]
  return join(`vllm serve ${repo}`, flags)
}
