import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CORE = join(process.cwd(), 'src/core')
const FORBIDDEN = /from\s+['"](react|react-dom|@testing-library|.*\.css)['"]/

describe('core purity', () => {
  it('core imports no React and no DOM-bound packages', () => {
    for (const f of readdirSync(CORE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = readFileSync(join(CORE, f), 'utf8')
      expect(FORBIDDEN.test(src), `${f} imports a forbidden module`).toBe(false)
    }
  })
})
