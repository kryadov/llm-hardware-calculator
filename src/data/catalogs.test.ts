import { describe, it, expect } from 'vitest'
import { MODELS, ACCELERATORS, PROFILES, PRICING, COEFFICIENTS } from './index'

describe('catalogs', () => {
  it('has at least 20 models covering all five families', () => {
    expect(MODELS.length).toBeGreaterThanOrEqual(20)
    for (const f of ['Kimi', 'GLM', 'DeepSeek', 'Qwen', 'MiniMax']) {
      expect(MODELS.some((m) => m.family === f), `missing family ${f}`).toBe(true)
    }
  })

  it('every model cites a HuggingFace config.json and a verification date', () => {
    for (const m of MODELS) {
      expect(m.sourceUrl, m.id).toMatch(/^https:\/\/huggingface\.co\/.+\/blob\/.+\/config\.json$/)
      expect(m.verifiedAt, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('active params never exceed total params', () => {
    for (const m of MODELS) expect(m.activeParams, m.id).toBeLessThanOrEqual(m.totalParams)
  })

  it('MoE models have a strictly smaller active count', () => {
    for (const m of MODELS.filter((m) => m.moe)) {
      expect(m.activeParams, m.id).toBeLessThan(m.totalParams)
    }
  })

  it('covers every vendor class', () => {
    for (const v of ['nvidia', 'amd', 'consumer', 'chinese', 'cpu-apple']) {
      expect(ACCELERATORS.some((a) => a.vendor === v), `missing vendor ${v}`).toBe(true)
    }
  })

  it('every accelerator resolves a coefficient family', () => {
    for (const a of ACCELERATORS) {
      expect(COEFFICIENTS.families[a.coefficientFamily], a.id).toBeDefined()
    }
  })

  it('every accelerator has a pricing row', () => {
    for (const a of ACCELERATORS) expect(PRICING.gpus[a.id], a.id).toBeDefined()
  })

  it('pricing carries an as-of date', () => {
    expect(PRICING.pricesAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('has the four load profiles', () => {
    expect(PROFILES.map((p) => p.id).sort()).toEqual(['batch', 'chat', 'coding-agent', 'rag'])
  })
})
