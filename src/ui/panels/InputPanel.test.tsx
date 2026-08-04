/**
 * Input-panel tests — plan Task 14, Step 1.
 *
 * Every query goes through `getByLabelText`, because the same association that
 * makes a control findable here is the one a screen reader follows. A control
 * that fails these tests is a control nobody can label out loud.
 */
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ACCELERATORS, MODELS, PROFILES } from '../../data'
import { LangProvider } from '../i18n'
import type { Lang } from '../i18n'
import { DEFAULT_STATE } from '../state'
import type { FormState } from '../state'
import { InputPanel, effectiveWorkload, isCustomProfile, selectedModel } from './InputPanel'
import { DEFAULT_PIN, resolvePin, solvePin } from './VerifyPanel'

interface Harness {
  onChange: ReturnType<typeof vi.fn>
  state: () => FormState
}

/**
 * Render the panel wired to real state, so a change is reflected back into the
 * controls exactly as it will be in the app, while `onChange` still records the
 * raw patch the panel emitted.
 */
function renderPanel(initial: Partial<FormState> = {}, lang?: Lang): Harness {
  const onChange = vi.fn()
  let current: FormState = { ...DEFAULT_STATE, ...initial }

  function Wrapper() {
    const [state, setState] = useState<FormState>(current)
    current = state
    return (
      <InputPanel
        state={state}
        onChange={(patch) => {
          onChange(patch)
          setState((prev) => ({ ...prev, ...patch }))
        }}
      />
    )
  }

  render(
    lang === undefined ? (
      <Wrapper />
    ) : (
      <LangProvider lang={lang}>
        <Wrapper />
      </LangProvider>
    ),
  )

  return { onChange, state: () => current }
}

const modelSelect = (): HTMLSelectElement => screen.getByLabelText('Model') as HTMLSelectElement
const optionFor = (select: HTMLSelectElement, value: string): HTMLOptionElement => {
  const option = Array.from(select.options).find((o) => o.value === value)
  if (option === undefined) throw new Error(`no option for ${value}`)
  return option
}

const openAdvanced = (label = 'Advanced'): void => {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('InputPanel', () => {
  it('renders the model select populated from the catalog', () => {
    renderPanel()
    const select = modelSelect()

    expect(select.querySelectorAll('option')).toHaveLength(MODELS.length)
    expect(select.value).toBe(DEFAULT_STATE.modelId)

    const families = new Set(MODELS.map((m) => m.family))
    expect(select.querySelectorAll('optgroup')).toHaveLength(families.size)
    for (const family of families) {
      expect(select.querySelector(`optgroup[label="${family}"]`)).not.toBeNull()
    }

    // Each option is badged with total/active parameters and the attention type.
    const moe = optionFor(select, 'deepseek-v3.2-exp').textContent ?? ''
    expect(moe).toContain('DeepSeek-V3.2-Exp')
    expect(moe).toContain('671B')
    expect(moe).toContain('MoE')
    expect(moe).toContain('37B')
    expect(moe).toContain('MLA')

    const dense = optionFor(select, 'qwen3-32b').textContent ?? ''
    expect(dense).toContain('dense')
    expect(dense).toContain('GQA')
  })

  it('selecting a model emits the new model id', () => {
    const h = renderPanel()
    fireEvent.change(modelSelect(), { target: { value: 'glm-4.6' } })

    expect(h.onChange).toHaveBeenCalledWith({ modelId: 'glm-4.6' })
    expect(modelSelect().value).toBe('glm-4.6')
    expect(selectedModel(h.state()).displayName).toBe('GLM-4.6')
  })

  it('shows the derived load strip for the selected profile and DAU', () => {
    const h = renderPanel({ profileId: 'coding-agent', dau: 500 })
    const strip = screen.getByTestId('derived-load')

    // 40 requests/day x 12,000 prompt x 800 output, peak x4 — from profiles.json.
    expect(strip.textContent).toContain('40')
    expect(strip.textContent).toContain('12,000')
    expect(strip.textContent).toContain('800')
    expect(strip.textContent).toContain('×4')

    const before = strip.textContent
    fireEvent.change(screen.getByLabelText('Daily active users'), { target: { value: '5000' } })

    expect(h.onChange).toHaveBeenCalledWith({ dau: 5000 })
    // The DAU-derived half of the strip (peak req/s, concurrency) moved with it.
    expect(screen.getByTestId('derived-load').textContent).not.toBe(before)
  })

  it('the derived strip follows the profile select', () => {
    const h = renderPanel()
    expect(screen.getByTestId('derived-load').textContent).toContain('1,200')

    fireEvent.change(screen.getByLabelText('Load profile'), { target: { value: 'rag' } })

    expect(h.onChange).toHaveBeenCalledWith({ profileId: 'rag' })
    expect(screen.getByTestId('derived-load').textContent).toContain('6,000')
  })

  it('the profile select carries every catalog profile', () => {
    renderPanel()
    const select = screen.getByLabelText('Load profile') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(PROFILES.map((p) => p.id))
    expect(select.value).toBe(DEFAULT_STATE.profileId)
  })

  it('editing an advanced field flips the profile label to Custom', () => {
    const h = renderPanel({ profileId: 'coding-agent' })
    expect(screen.queryByText('Custom')).toBeNull()

    openAdvanced()
    fireEvent.change(screen.getByLabelText('Prompt tokens'), { target: { value: '9000' } })

    expect(h.onChange).toHaveBeenCalledWith({ overrides: { promptTokens: 9000 } })
    expect(screen.getByText('Custom')).toBeInTheDocument()

    // The stored profile id is untouched: the override sits on top of it.
    expect((screen.getByLabelText('Load profile') as HTMLSelectElement).value).toBe('coding-agent')
    expect(h.state().profileId).toBe('coding-agent')
    expect(h.state().overrides).toEqual({ promptTokens: 9000 })
    expect(isCustomProfile(h.state().overrides)).toBe(true)
  })

  it('clearing an advanced field drops the override and returns to the profile value', () => {
    const h = renderPanel({ overrides: { promptTokens: 9000 } })
    openAdvanced()
    const field = screen.getByLabelText('Prompt tokens') as HTMLInputElement
    expect(field.value).toBe('9000')

    fireEvent.change(field, { target: { value: '' } })

    expect(h.onChange).toHaveBeenCalledWith({ overrides: {} })
    expect(h.state().overrides).toEqual({})
    expect((screen.getByLabelText('Prompt tokens') as HTMLInputElement).value).toBe('1200')
    expect(screen.queryByText('Custom')).toBeNull()
  })

  it('exposes every advanced knob the spec lists, each with a real label', () => {
    renderPanel()
    openAdvanced()

    expect(screen.getByLabelText('Prompt tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Output tokens')).toBeInTheDocument()
    expect(screen.getByLabelText('Peak factor')).toBeInTheDocument()
    expect(screen.getByLabelText('Prefix cache hit rate')).toBeInTheDocument()
    expect(screen.getByLabelText('SLA: tokens/s per user')).toBeInTheDocument()
    expect(screen.getByLabelText('SLA: TTFT, p95')).toBeInTheDocument()
    expect(screen.getByLabelText('Max context')).toBeInTheDocument()
    expect(screen.getByLabelText('Speculative decoding / MTP')).toBeInTheDocument()
    expect(screen.getByLabelText('gpu-memory-utilization')).toBeInTheDocument()
    expect(screen.getByLabelText('KV cache quantization')).toBeInTheDocument()
  })

  it('the advanced toggles emit boolean and enum overrides', () => {
    const h = renderPanel()
    openAdvanced()

    fireEvent.click(screen.getByLabelText('Speculative decoding / MTP'))
    expect(h.state().overrides.speculative).toBe(true)

    fireEvent.change(screen.getByLabelText('KV cache quantization'), { target: { value: 'fp8' } })
    expect(h.state().overrides.kvQuant).toBe('fp8')
    expect(effectiveWorkload(h.state()).kvQuant).toBe('fp8')
  })

  it('the max-context field is capped at what the model supports', () => {
    renderPanel({ modelId: 'glm-4-32b-0414' })
    openAdvanced()
    const field = screen.getByLabelText('Max context') as HTMLInputElement
    const native = MODELS.find((m) => m.id === 'glm-4-32b-0414')?.maxContext
    expect(native).toBe(32768)
    expect(field.max).toBe('32768')
    expect(field.value).toBe('32768')
  })

  it('the quantization segmented control emits the chosen quant', () => {
    const h = renderPanel()
    const bf16 = screen.getByLabelText('BF16') as HTMLInputElement
    expect((screen.getByLabelText('FP8') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(bf16)

    expect(h.onChange).toHaveBeenCalledWith({ quant: 'bf16' })
    expect(bf16.checked).toBe(true)
  })

  it('unchecking a vendor removes it from the emitted state', () => {
    const h = renderPanel()
    const amd = screen.getByLabelText('AMD') as HTMLInputElement
    expect(amd.checked).toBe(true)

    fireEvent.click(amd)

    expect(h.onChange).toHaveBeenCalledWith({ vendors: ['nvidia', 'consumer', 'chinese'] })
    expect(h.state().vendors).toEqual(['nvidia', 'consumer', 'chinese'])
    expect((screen.getByLabelText('AMD') as HTMLInputElement).checked).toBe(false)
  })

  it('checking a vendor puts it back in canonical order', () => {
    const h = renderPanel({ vendors: ['nvidia'] })
    fireEvent.click(screen.getByLabelText('CPU / Apple'))
    expect(h.state().vendors).toEqual(['nvidia', 'cpu-apple'])
  })

  it('the cost-mode segmented control emits the chosen mode', () => {
    const h = renderPanel()
    expect((screen.getByLabelText('Rent') as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByLabelText('Buy'))

    expect(h.onChange).toHaveBeenCalledWith({ costMode: 'buy' })
  })

  it('renders in Russian when lang is ru', () => {
    renderPanel({}, 'ru')

    expect(screen.getByLabelText('Модель')).toBeInTheDocument()
    expect(screen.getByLabelText('Профиль нагрузки')).toBeInTheDocument()
    expect(screen.getByLabelText('Активных пользователей в день')).toBeInTheDocument()
    expect(screen.getByLabelText('Китайские')).toBeInTheDocument()
    expect(screen.getByLabelText('Аренда')).toBeInTheDocument()
    expect(screen.queryByLabelText('Model')).toBeNull()

    openAdvanced('Дополнительно')
    expect(screen.getByLabelText('Токенов в промпте')).toBeInTheDocument()
    expect(screen.getByTestId('derived-load').textContent).toContain('запросов/день')
  })
})

describe('VerifyPanel', () => {
  it('replaces the vendor filter with pinned-hardware controls', () => {
    renderPanel({ tab: 'verify' })

    expect(screen.getByLabelText('Accelerator')).toBeInTheDocument()
    expect(screen.getByLabelText('How many')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantization')).toBeInTheDocument()

    expect(screen.queryByLabelText('NVIDIA')).toBeNull()
    expect(screen.queryByLabelText('AMD')).toBeNull()
    // Weight quantization moves into the pinned-hardware block, it is not shown twice.
    expect(screen.queryByLabelText('Weight quantization')).toBeNull()
  })

  it('the accelerator select carries every catalog accelerator', () => {
    renderPanel({ tab: 'verify' })
    const select = screen.getByLabelText('Accelerator') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual(ACCELERATORS.map((a) => a.id))
    expect(select.value).toBe(DEFAULT_PIN.acceleratorId)
  })

  it('choosing hardware and a fleet size emits a complete pin', () => {
    const h = renderPanel({ tab: 'verify' })

    fireEvent.change(screen.getByLabelText('Accelerator'), { target: { value: 'mi300x-192' } })
    expect(h.onChange).toHaveBeenCalledWith({
      pin: { acceleratorId: 'mi300x-192', totalGpus: DEFAULT_PIN.totalGpus },
    })

    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '16' } })
    expect(h.state().pin).toEqual({ acceleratorId: 'mi300x-192', totalGpus: 16 })

    fireEvent.change(screen.getByLabelText('Quantization'), { target: { value: 'int4' } })
    expect(h.state().quant).toBe('int4')
    expect(solvePin(h.state())).toEqual({
      acceleratorId: 'mi300x-192',
      totalGpus: 16,
      quant: 'int4',
    })
  })

  it('resolvePin fills in a default fleet before the user has pinned anything', () => {
    expect(resolvePin(null)).toEqual(DEFAULT_PIN)
    expect(resolvePin({ acceleratorId: 'h200-sxm-141', totalGpus: 4 })).toEqual({
      acceleratorId: 'h200-sxm-141',
      totalGpus: 4,
    })
    expect(ACCELERATORS.some((a) => a.id === DEFAULT_PIN.acceleratorId)).toBe(true)
  })
})

describe('effectiveWorkload', () => {
  it('layers overrides on top of the profile without touching the profile id', () => {
    const w = effectiveWorkload({
      ...DEFAULT_STATE,
      profileId: 'chat',
      dau: 2500,
      overrides: { promptTokens: 9000, slaTokensPerSec: 40 },
    })

    expect(w.profileId).toBe('chat')
    expect(w.dau).toBe(2500)
    expect(w.promptTokens).toBe(9000)
    expect(w.slaTokensPerSec).toBe(40)
    // Untouched fields still come from the profile.
    expect(w.outputTokens).toBe(500)
    expect(w.maxContext).toBe(selectedModel(DEFAULT_STATE).maxContext)
  })

  it('is total against a state naming ids that are not in the catalog', () => {
    const w = effectiveWorkload({ ...DEFAULT_STATE, modelId: 'nope', profileId: 'nope' })
    expect(Number.isFinite(w.promptTokens)).toBe(true)
    expect(Number.isFinite(w.maxContext)).toBe(true)
  })

  it('isCustomProfile ignores an empty override bag', () => {
    expect(isCustomProfile({})).toBe(false)
    expect(isCustomProfile({ peakFactor: 2 })).toBe(true)
  })
})
