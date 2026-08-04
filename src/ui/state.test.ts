/**
 * Task 13 — form state and the URL round trip.
 *
 * The shareable link is the tool's primary return path (spec §4 "Состояние в
 * URL"), so the contract under test is: every state reachable through the UI
 * survives `encode → decode` unchanged, a default state produces an empty query
 * string, and a corrupted link never throws — each bad field falls back on its
 * own while its neighbours survive (spec §7 "Битая ссылка или состояние из URL").
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCELERATORS, MODELS, PROFILES } from '../data'
import { DEFAULT_STATE, decodeState, encodeState, useUrlState } from './state'
import type { FormState } from './state'

const setSearch = (qs: string): void => {
  window.history.replaceState(null, '', qs ? `/?${qs}` : '/')
}

const otherModelId = MODELS.filter((m) => m.id !== DEFAULT_STATE.modelId)[0].id
const otherProfileId = PROFILES.filter((p) => p.id !== DEFAULT_STATE.profileId)[0].id
const someAcceleratorId = ACCELERATORS[0].id

const CUSTOM: FormState = {
  tab: 'verify',
  modelId: otherModelId,
  quant: 'int4',
  profileId: otherProfileId,
  dau: 12345,
  overrides: {
    promptTokens: 9000,
    outputTokens: 1500,
    requestsPerUserPerDay: 40,
    peakFactor: 4.5,
    prefixCacheHitRate: 0.55,
    slaTokensPerSec: 25,
    slaTtftSeconds: 2.5,
    maxContext: 65536,
    speculative: true,
    gpuMemUtil: 0.85,
    kvQuant: 'fp8',
  },
  vendors: ['amd', 'chinese'],
  costMode: 'buy',
  lang: 'ru',
  pin: { acceleratorId: someAcceleratorId, totalGpus: 16 },
}

describe('decodeState / encodeState', () => {
  it('round-trips the default state', () => {
    expect(decodeState(encodeState(DEFAULT_STATE))).toEqual(DEFAULT_STATE)
  })

  it('encodes the default state to the empty string', () => {
    expect(encodeState(DEFAULT_STATE)).toBe('')
  })

  it('round-trips a fully customised state including overrides', () => {
    const qs = encodeState(CUSTOM)
    expect(qs).not.toBe('')
    expect(decodeState(qs)).toEqual(CUSTOM)
  })

  it('round-trips a pinned verify state', () => {
    const pinned: FormState = {
      ...DEFAULT_STATE,
      tab: 'verify',
      pin: { acceleratorId: someAcceleratorId, totalGpus: 8 },
    }
    expect(decodeState(encodeState(pinned))).toEqual(pinned)
  })

  it('round-trips an empty vendor selection distinctly from the default', () => {
    const none: FormState = { ...DEFAULT_STATE, vendors: [] }
    expect(decodeState(encodeState(none)).vendors).toEqual([])
    expect(decodeState('').vendors).toEqual(DEFAULT_STATE.vendors)
  })

  it('tolerates a leading question mark', () => {
    expect(decodeState('?dau=777').dau).toBe(777)
  })

  it('falls back to defaults for an unknown model id', () => {
    const s = decodeState(`m=totally-not-a-model&dau=250&c=buy`)
    expect(s.modelId).toBe(DEFAULT_STATE.modelId)
    expect(s.dau).toBe(250)
    expect(s.costMode).toBe('buy')
  })

  it('falls back to defaults for an unknown profile id but keeps the rest', () => {
    const s = decodeState(`p=nope&m=${otherModelId}`)
    expect(s.profileId).toBe(DEFAULT_STATE.profileId)
    expect(s.modelId).toBe(otherModelId)
  })

  it('drops a pin naming an unknown accelerator', () => {
    const s = decodeState(`pin=fictional-tpu:8&dau=999`)
    expect(s.pin).toBeNull()
    expect(s.dau).toBe(999)
  })

  it('drops a pin whose gpu count is not a positive integer', () => {
    expect(decodeState(`pin=${someAcceleratorId}:0`).pin).toBeNull()
    expect(decodeState(`pin=${someAcceleratorId}:3.5`).pin).toBeNull()
    expect(decodeState(`pin=${someAcceleratorId}:abc`).pin).toBeNull()
    expect(decodeState(`pin=${someAcceleratorId}`).pin).toBeNull()
  })

  it('falls back to defaults for garbage input without throwing', () => {
    const garbage = [
      '%%%&&&===',
      'm=%E0%A4%A&q=&&&',
      'dau=NaN&q=fp0&p=&v=&&tab=sideways&c=barter&lang=klingon&pin=:::',
      'o.promptTokens=hello&o.speculative=maybe&o.kvQuant=fp99&o.gpuMemUtil=',
      'dau=-5&o.peakFactor=Infinity&o.prefixCacheHitRate=17',
      '=&=&==',
      'o.promptTokens=1e999&o.maxContext=0',
    ]
    for (const qs of garbage) {
      let s: FormState | undefined
      expect(() => {
        s = decodeState(qs)
      }).not.toThrow()
      expect(s).toBeDefined()
      expect(MODELS.some((m) => m.id === s!.modelId)).toBe(true)
      expect(PROFILES.some((p) => p.id === s!.profileId)).toBe(true)
      expect(Number.isFinite(s!.dau)).toBe(true)
      expect(s!.dau).toBeGreaterThan(0)
    }
  })

  it('ignores an out-of-range number and keeps the field default', () => {
    expect(decodeState('dau=0').dau).toBe(DEFAULT_STATE.dau)
    expect(decodeState('dau=-1').dau).toBe(DEFAULT_STATE.dau)
    expect(decodeState('o.prefixCacheHitRate=2').overrides.prefixCacheHitRate).toBeUndefined()
    expect(decodeState('o.gpuMemUtil=0.85').overrides.gpuMemUtil).toBe(0.85)
  })

  it('drops fields equal to the default to keep URLs short', () => {
    const qs = encodeState({ ...DEFAULT_STATE, dau: 4321 })
    const params = new URLSearchParams(qs)
    expect([...params.keys()]).toEqual(['dau'])
    expect(params.get('dau')).toBe('4321')
  })

  it('does not emit a vendor param when the selection matches the default in any order', () => {
    const reordered = [...DEFAULT_STATE.vendors].reverse()
    expect(encodeState({ ...DEFAULT_STATE, vendors: reordered })).toBe('')
  })

  it('preserves lang across the round trip', () => {
    for (const lang of ['en', 'ru'] as const) {
      expect(decodeState(encodeState({ ...DEFAULT_STATE, lang })).lang).toBe(lang)
    }
    expect(decodeState('lang=klingon').lang).toBe(DEFAULT_STATE.lang)
  })

  it('keeps every override key it was given', () => {
    const s = decodeState(encodeState(CUSTOM))
    expect(Object.keys(s.overrides).sort()).toEqual(Object.keys(CUSTOM.overrides).sort())
  })
})

describe('useUrlState', () => {
  beforeEach(() => {
    setSearch('')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setSearch('')
  })

  it('reads window.location.search on mount', () => {
    setSearch(`m=${otherModelId}&dau=777&c=buy`)
    const { result } = renderHook(() => useUrlState())
    expect(result.current[0].modelId).toBe(otherModelId)
    expect(result.current[0].dau).toBe(777)
    expect(result.current[0].costMode).toBe('buy')
  })

  it('recovers from a broken link instead of throwing', () => {
    setSearch('m=ghost&dau=NaN&pin=:::')
    const { result } = renderHook(() => useUrlState())
    expect(result.current[0]).toEqual(DEFAULT_STATE)
  })

  it('writes the patched state back to the URL with replaceState, never pushState', () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    const push = vi.spyOn(window.history, 'pushState')
    const { result } = renderHook(() => useUrlState())
    act(() => {
      result.current[1]({ dau: 4242 })
    })
    expect(result.current[0].dau).toBe(4242)
    expect(new URLSearchParams(window.location.search).get('dau')).toBe('4242')
    expect(replace).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('merges a patch into the existing state', () => {
    const { result } = renderHook(() => useUrlState())
    act(() => {
      result.current[1]({ dau: 50 })
    })
    act(() => {
      result.current[1]({ quant: 'int8' })
    })
    expect(result.current[0].dau).toBe(50)
    expect(result.current[0].quant).toBe('int8')
    expect(result.current[0].modelId).toBe(DEFAULT_STATE.modelId)
  })

  it('leaves a default state with a clean URL', () => {
    setSearch('dau=99')
    const { result } = renderHook(() => useUrlState())
    act(() => {
      result.current[1]({ dau: DEFAULT_STATE.dau })
    })
    expect(window.location.search).toBe('')
  })
})
