/**
 * Form state and its URL projection — plan Task 13, spec §4 ("Состояние в URL").
 *
 * The shareable link is how a calculation travels between engineers, so the
 * query string is the single source of truth for every input. Two rules keep it
 * usable:
 *
 * 1. `encodeState` omits every field that still equals its default, so a fresh
 *    page has a bare URL and a shared link contains only what the sender
 *    actually changed.
 * 2. `decodeState` never throws. A link from an older build, a truncated paste
 *    or hand-edited junk degrades field by field: an unknown model id falls back
 *    to the default model while the DAU next to it survives (spec §7, "Битая
 *    ссылка ... не роняет страницу").
 *
 * Ids are validated against the real catalogs rather than a hardcoded list, so
 * retiring a model from `src/data` automatically invalidates links naming it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CostMode, KvQuant, Quant, Vendor, Workload } from '../core/types'
import { ACCELERATORS, MODELS, PROFILES } from '../data'
import { DEFAULT_DEPLOYMENT_INPUTS } from '../deploy'
import type {
  AvailabilityPolicy,
  DeploymentInputs,
  Facility,
  Region,
  SoftwareOptionKind,
  SoftwarePreset,
  StaffingMode,
} from '../deploy'
import type { Lang } from './i18n'

export type Tab = 'explore' | 'verify' | 'deploy'

export interface Pin {
  acceleratorId: string
  /** Size of the fleet the user already owns, in accelerators. */
  totalGpus: number
}

export interface FormState {
  tab: Tab
  modelId: string
  quant: Quant
  profileId: string
  dau: number
  /** Advanced fields the user overrode; absent keys follow the load profile. */
  overrides: Partial<Workload>
  vendors: Vendor[]
  costMode: CostMode
  lang: Lang
  pin: Pin | null
  /** Deploy tab inputs — spec `2026-08-06-turnkey-deployment-design.md` §2.2. */
  deploy: DeploymentInputs
}

const QUANTS: readonly Quant[] = ['bf16', 'fp8', 'int8', 'int4']
const KV_QUANTS: readonly KvQuant[] = ['fp16', 'fp8', 'int4']
const COST_MODES: readonly CostMode[] = ['buy', 'rent', 'off']
const TABS: readonly Tab[] = ['explore', 'verify', 'deploy']
const LANGS: readonly Lang[] = ['en', 'ru']

const FACILITIES: readonly Facility[] = ['colo', 'on-prem', 'cloud']
const REGIONS: readonly Region[] = ['us', 'eu', 'ru', 'apac']
const AVAILABILITY_POLICIES: readonly AvailabilityPolicy[] = ['none', 'n+1', 'n+1-spare', 'dual-site']
const STAFFING_MODES: readonly StaffingMode[] = ['business-hours', 'extended', '24x7']
const SOFTWARE_PRESETS: readonly SoftwarePreset[] = ['internal', 'commercial', 'regulated']
const SOFTWARE_OPTION_KINDS: readonly SoftwareOptionKind[] = ['managed', 'oss', 'build']

/** Canonical vendor order, so a vendor set always encodes the same way. */
export const VENDOR_ORDER: readonly Vendor[] = [
  'nvidia',
  'amd',
  'consumer',
  'chinese',
  'cpu-apple',
]

const fallbackModelId = (): string =>
  MODELS.some((m) => m.id === 'deepseek-v3.2-exp') ? 'deepseek-v3.2-exp' : MODELS[0].id

const fallbackProfileId = (): string =>
  PROFILES.some((p) => p.id === 'chat') ? 'chat' : PROFILES[0].id

/**
 * Defaults: a mainstream MoE model at FP8 under the chat profile, rented
 * hardware (the `$/1M tokens` ranking of spec §3.6), datacenter and consumer
 * silicon on, CPU/Mac off because it only makes sense for deliberate low-QPS
 * experiments.
 */
export const DEFAULT_STATE: FormState = {
  tab: 'explore',
  modelId: fallbackModelId(),
  quant: 'fp8',
  profileId: fallbackProfileId(),
  dau: 1000,
  overrides: {},
  vendors: ['nvidia', 'amd', 'consumer', 'chinese'],
  costMode: 'rent',
  lang: 'en',
  pin: null,
  deploy: DEFAULT_DEPLOYMENT_INPUTS,
}

/** Query-string keys, kept short because the URL is meant to be pasted. */
const KEY = {
  tab: 'tab',
  model: 'm',
  quant: 'q',
  profile: 'p',
  dau: 'dau',
  vendors: 'v',
  costMode: 'c',
  lang: 'lang',
  pin: 'pin',
  dFacility: 'df',
  dRegion: 'dr',
  dAvailability: 'da',
  dStaffing: 'dst',
  dHorizon: 'dh',
  dPreset: 'dp',
} as const

/** Prefix for every `overrides` entry: `o.promptTokens=9000`. */
const OVERRIDE_PREFIX = 'o.'
/** Prefix for every deploy rate override: `do.chassisUsd=90000`. */
const DEPLOY_OVERRIDE_PREFIX = 'do.'
/** Prefix for every deploy software-selection override: `dso.gateway=managed`. */
const DEPLOY_SOFTWARE_PREFIX = 'dso.'

interface Range {
  min: number
  max: number
}

/**
 * Plausible bounds for every user-editable number. A value outside its range is
 * treated exactly like garbage: the field falls back, the rest of the state
 * survives. Bounds are deliberately loose — they exist to reject nonsense from a
 * corrupted link, not to police what an engineer may model.
 */
const DAU_RANGE: Range = { min: 1, max: 1e9 }
const GPU_COUNT_RANGE: Range = { min: 1, max: 100_000 }

const NUMERIC_OVERRIDES = {
  requestsPerUserPerDay: { min: 0.001, max: 100_000 },
  promptTokens: { min: 1, max: 10_000_000 },
  outputTokens: { min: 1, max: 10_000_000 },
  peakFactor: { min: 1, max: 1000 },
  prefixCacheHitRate: { min: 0, max: 0.99 },
  slaTokensPerSec: { min: 0.1, max: 100_000 },
  slaTtftSeconds: { min: 0.001, max: 3600 },
  maxContext: { min: 128, max: 100_000_000 },
  gpuMemUtil: { min: 0.05, max: 0.99 },
} as const satisfies Record<string, Range>

type NumericOverrideKey = keyof typeof NUMERIC_OVERRIDES

const NUMERIC_OVERRIDE_KEYS = Object.keys(NUMERIC_OVERRIDES) as NumericOverrideKey[]

/**
 * The `Workload` keys the UI can override. `profileId` and `dau` are excluded on
 * purpose: they live at the top level of {@link FormState}, and letting them
 * appear twice would make the URL self-contradictory.
 */
export const OVERRIDE_KEYS: readonly (keyof Workload)[] = [
  ...NUMERIC_OVERRIDE_KEYS,
  'speculative',
  'kvQuant',
]

const inRange = (n: number, r: Range): boolean => Number.isFinite(n) && n >= r.min && n <= r.max

const readNumber = (raw: string | null, r: Range): number | undefined => {
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return inRange(n, r) ? n : undefined
}

const readEnum = <T extends string>(raw: string | null, allowed: readonly T[]): T | undefined =>
  raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined

const readBoolean = (raw: string | null): boolean | undefined => {
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return undefined
}

const canonicalVendors = (vendors: readonly Vendor[]): Vendor[] =>
  VENDOR_ORDER.filter((v) => vendors.includes(v))

const sameVendors = (a: readonly Vendor[], b: readonly Vendor[]): boolean => {
  const ca = canonicalVendors(a)
  const cb = canonicalVendors(b)
  return ca.length === cb.length && ca.every((v, i) => v === cb[i])
}

/**
 * Encode a state as a query string with no leading `?`.
 *
 * Fields equal to their default are omitted, so `encodeState(DEFAULT_STATE)`
 * is `''`.
 */
export function encodeState(s: FormState): string {
  const params = new URLSearchParams()

  if (s.tab !== DEFAULT_STATE.tab) params.set(KEY.tab, s.tab)
  if (s.modelId !== DEFAULT_STATE.modelId) params.set(KEY.model, s.modelId)
  if (s.quant !== DEFAULT_STATE.quant) params.set(KEY.quant, s.quant)
  if (s.profileId !== DEFAULT_STATE.profileId) params.set(KEY.profile, s.profileId)
  if (s.dau !== DEFAULT_STATE.dau) params.set(KEY.dau, String(s.dau))

  for (const key of OVERRIDE_KEYS) {
    const value = s.overrides[key]
    if (value === undefined) continue
    params.set(`${OVERRIDE_PREFIX}${key}`, String(value))
  }

  // An empty selection is meaningful (the user unchecked everything), so it is
  // encoded as an empty value rather than dropped.
  if (!sameVendors(s.vendors, DEFAULT_STATE.vendors)) {
    params.set(KEY.vendors, canonicalVendors(s.vendors).join(','))
  }
  if (s.costMode !== DEFAULT_STATE.costMode) params.set(KEY.costMode, s.costMode)
  if (s.lang !== DEFAULT_STATE.lang) params.set(KEY.lang, s.lang)
  if (s.pin !== null) params.set(KEY.pin, `${s.pin.acceleratorId}:${s.pin.totalGpus}`)

  const d = s.deploy
  const dDefault = DEFAULT_STATE.deploy
  if (d.facility !== dDefault.facility) params.set(KEY.dFacility, d.facility)
  if (d.region !== dDefault.region) params.set(KEY.dRegion, d.region)
  if (d.availabilityPolicy !== dDefault.availabilityPolicy) params.set(KEY.dAvailability, d.availabilityPolicy)
  if (d.staffing !== dDefault.staffing) params.set(KEY.dStaffing, d.staffing)
  if (d.horizonYears !== dDefault.horizonYears) params.set(KEY.dHorizon, String(d.horizonYears))
  if (d.softwarePreset !== dDefault.softwarePreset) params.set(KEY.dPreset, d.softwarePreset)
  for (const [key, value] of Object.entries(d.overrides ?? {})) {
    if (value === undefined) continue
    params.set(`${DEPLOY_OVERRIDE_PREFIX}${key}`, String(value))
  }
  for (const [key, kind] of Object.entries(d.softwareOverrides ?? {})) {
    if (kind === undefined) continue
    params.set(`${DEPLOY_SOFTWARE_PREFIX}${key}`, kind)
  }

  return params.toString()
}

const decodeOverrides = (params: URLSearchParams): Partial<Workload> => {
  const overrides: Partial<Workload> = {}

  for (const key of NUMERIC_OVERRIDE_KEYS) {
    const n = readNumber(params.get(`${OVERRIDE_PREFIX}${key}`), NUMERIC_OVERRIDES[key])
    if (n !== undefined) overrides[key] = n
  }

  const speculative = readBoolean(params.get(`${OVERRIDE_PREFIX}speculative`))
  if (speculative !== undefined) overrides.speculative = speculative

  const kvQuant = readEnum(params.get(`${OVERRIDE_PREFIX}kvQuant`), KV_QUANTS)
  if (kvQuant !== undefined) overrides.kvQuant = kvQuant

  return overrides
}

const decodeVendors = (params: URLSearchParams): Vendor[] => {
  const raw = params.get(KEY.vendors)
  if (raw === null) return DEFAULT_STATE.vendors
  if (raw.trim() === '') return []
  const named = raw.split(',').map((v) => v.trim())
  const known = VENDOR_ORDER.filter((v) => named.includes(v))
  // Every token was junk: treat the field as unset rather than as "no hardware".
  return known.length > 0 ? known : DEFAULT_STATE.vendors
}

const HORIZON_RANGE: Range = { min: 1, max: 15 }
/** Deploy rate overrides are arbitrary USD/kW/etc figures — loose bounds, same spirit as {@link DAU_RANGE}. */
const DEPLOY_RATE_RANGE: Range = { min: 0, max: 1e12 }

/**
 * Decode `DeploymentInputs` from the query string. Every field falls back
 * independently, same discipline as the rest of this file: a stale or
 * hand-edited `deploy` link degrades field by field rather than resetting
 * the whole tab.
 */
const decodeDeploy = (params: URLSearchParams): DeploymentInputs => {
  const overrides: Record<string, number> = {}
  const prefix = DEPLOY_OVERRIDE_PREFIX
  for (const [key, raw] of params) {
    if (!key.startsWith(prefix)) continue
    const n = readNumber(raw, DEPLOY_RATE_RANGE)
    if (n !== undefined) overrides[key.slice(prefix.length)] = n
  }

  const softwareOverrides: Record<string, SoftwareOptionKind> = {}
  const swPrefix = DEPLOY_SOFTWARE_PREFIX
  for (const [key, raw] of params) {
    if (!key.startsWith(swPrefix)) continue
    const kind = readEnum(raw, SOFTWARE_OPTION_KINDS)
    if (kind !== undefined) softwareOverrides[key.slice(swPrefix.length)] = kind
  }

  return {
    facility: readEnum(params.get(KEY.dFacility), FACILITIES) ?? DEFAULT_DEPLOYMENT_INPUTS.facility,
    region: readEnum(params.get(KEY.dRegion), REGIONS) ?? DEFAULT_DEPLOYMENT_INPUTS.region,
    availabilityPolicy:
      readEnum(params.get(KEY.dAvailability), AVAILABILITY_POLICIES) ??
      DEFAULT_DEPLOYMENT_INPUTS.availabilityPolicy,
    staffing: readEnum(params.get(KEY.dStaffing), STAFFING_MODES) ?? DEFAULT_DEPLOYMENT_INPUTS.staffing,
    horizonYears: readNumber(params.get(KEY.dHorizon), HORIZON_RANGE) ?? DEFAULT_DEPLOYMENT_INPUTS.horizonYears,
    softwarePreset:
      readEnum(params.get(KEY.dPreset), SOFTWARE_PRESETS) ?? DEFAULT_DEPLOYMENT_INPUTS.softwarePreset,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    ...(Object.keys(softwareOverrides).length > 0 ? { softwareOverrides } : {}),
  }
}

const decodePin = (params: URLSearchParams): Pin | null => {
  const raw = params.get(KEY.pin)
  if (raw === null) return null
  const at = raw.lastIndexOf(':')
  if (at <= 0) return null
  const acceleratorId = raw.slice(0, at)
  if (!ACCELERATORS.some((a) => a.id === acceleratorId)) return null
  const totalGpus = readNumber(raw.slice(at + 1), GPU_COUNT_RANGE)
  if (totalGpus === undefined || !Number.isInteger(totalGpus)) return null
  return { acceleratorId, totalGpus }
}

/**
 * Decode a query string into a {@link FormState}. Never throws: any field that
 * is missing, unparseable, unknown to the catalogs or out of range falls back to
 * its default independently of the others.
 */
export function decodeState(qs: string): FormState {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs)
  } catch {
    return { ...DEFAULT_STATE, overrides: {}, vendors: [...DEFAULT_STATE.vendors] }
  }

  try {
    const modelId = params.get(KEY.model)
    const profileId = params.get(KEY.profile)

    return {
      tab: readEnum(params.get(KEY.tab), TABS) ?? DEFAULT_STATE.tab,
      modelId:
        modelId !== null && MODELS.some((m) => m.id === modelId)
          ? modelId
          : DEFAULT_STATE.modelId,
      quant: readEnum(params.get(KEY.quant), QUANTS) ?? DEFAULT_STATE.quant,
      profileId:
        profileId !== null && PROFILES.some((p) => p.id === profileId)
          ? profileId
          : DEFAULT_STATE.profileId,
      dau: readNumber(params.get(KEY.dau), DAU_RANGE) ?? DEFAULT_STATE.dau,
      overrides: decodeOverrides(params),
      vendors: decodeVendors(params),
      costMode: readEnum(params.get(KEY.costMode), COST_MODES) ?? DEFAULT_STATE.costMode,
      lang: readEnum(params.get(KEY.lang), LANGS) ?? DEFAULT_STATE.lang,
      pin: decodePin(params),
      deploy: decodeDeploy(params),
    }
  } catch {
    // Defence in depth: a decoding bug must not blank the page.
    return { ...DEFAULT_STATE, overrides: {}, vendors: [...DEFAULT_STATE.vendors] }
  }
}

const currentSearch = (): string =>
  typeof window === 'undefined' ? '' : window.location.search

/**
 * Form state mirrored into the URL.
 *
 * The initial value is read from `window.location.search` on mount, and every
 * change is written back with `history.replaceState` — never `pushState`, so the
 * back button leaves the calculator instead of stepping through every keystroke.
 */
export function useUrlState(): [FormState, (patch: Partial<FormState>) => void] {
  const [state, setState] = useState<FormState>(() => decodeState(currentSearch()))
  const lastWritten = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const qs = encodeState(state)
    if (lastWritten.current === qs) return
    lastWritten.current = qs
    const { pathname, hash } = window.location
    window.history.replaceState(null, '', `${pathname}${qs ? `?${qs}` : ''}${hash}`)
  }, [state])

  const patch = useCallback((next: Partial<FormState>) => {
    setState((prev) => ({ ...prev, ...next }))
  }, [])

  return [state, patch]
}
