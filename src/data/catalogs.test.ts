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

  /*
   * These guard the bug this catalog actually shipped: licenses were assigned
   * per FAMILY rather than per repository, and the UI decided "restricts
   * commercial use" by regex-matching the word "custom" in the human-readable
   * label. That simultaneously flagged all 8 MIT-licensed GLM models and stayed
   * silent about MiniMax M2.7 and M3, which genuinely forbid commercial use
   * without written authorization. Verified 2026-08-06 against each repo's own
   * LICENSE file.
   */
  it('every model cites the license it was actually read from', () => {
    for (const m of MODELS) {
      expect(m.license, m.id).toBeTruthy()
      expect(m.licenseSourceUrl, m.id).toMatch(/^https:\/\//)
      expect(m.licenseVerifiedAt, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('a commercial-use condition always states what the condition is', () => {
    for (const m of MODELS) {
      const c = m.licenseCommercialCondition
      if (!c) continue
      expect(['warning', 'blocking'], m.id).toContain(c.severity)
      // Boilerplate like "verify at repo" is what this field replaced.
      expect(c.detail.length, m.id).toBeGreaterThan(40)
      expect(c.detail, m.id).not.toMatch(/verify at repo/i)
    }
  })

  it('permissive licenses carry no commercial-use condition', () => {
    for (const m of MODELS.filter((m) => /^(MIT|Apache-2\.0)$/.test(m.license ?? ''))) {
      expect(m.licenseCommercialCondition, `${m.id} is ${m.license} and cannot gate commercial use`)
        .toBeUndefined()
    }
  })

  it('licenses are per-repository, not inherited from the family', () => {
    // Both families are deliberately mixed upstream; a uniform family here means
    // someone re-applied a blanket label instead of reading each LICENSE.
    for (const family of ['MiniMax', 'Kimi']) {
      const labels = new Set(MODELS.filter((m) => m.family === family).map((m) => m.license))
      expect(labels.size, `${family} licenses collapsed to one label`).toBeGreaterThan(1)
    }
  })

  it('the models known to gate commercial use are still flagged blocking', () => {
    for (const id of ['kimi-k3', 'minimax-m3', 'minimax-m2-7']) {
      const m = MODELS.find((x) => x.id === id)
      expect(m, id).toBeDefined()
      expect(m!.licenseCommercialCondition?.severity, id).toBe('blocking')
    }
  })

  it('the GLM family is plain MIT and flags nothing', () => {
    const glm = MODELS.filter((m) => m.family === 'GLM')
    expect(glm.length).toBeGreaterThan(0)
    for (const m of glm) {
      expect(m.license, m.id).toBe('MIT')
      expect(m.licenseCommercialCondition, m.id).toBeUndefined()
    }
  })

  it('has the four load profiles', () => {
    expect(PROFILES.map((p) => p.id).sort()).toEqual(['batch', 'chat', 'coding-agent', 'rag'])
  })
})
