import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CORE = join(process.cwd(), 'src/core')
const DEPLOY = join(process.cwd(), 'src/deploy')
const FORBIDDEN = /from\s+['"](react|react-dom|@testing-library|.*\.css)['"]/
const CORE_IMPORTING_DEPLOY = /from\s+['"](\.\.\/deploy|\.\/deploy)/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
}

describe('core purity', () => {
  it('core imports no React and no DOM-bound packages', () => {
    for (const f of sourceFiles(CORE)) {
      const src = readFileSync(join(CORE, f), 'utf8')
      expect(FORBIDDEN.test(src), `${f} imports a forbidden module`).toBe(false)
    }
  })

  it('core never imports from deploy — the dependency runs one way', () => {
    for (const f of sourceFiles(CORE)) {
      const src = readFileSync(join(CORE, f), 'utf8')
      expect(CORE_IMPORTING_DEPLOY.test(src), `${f} imports from src/deploy`).toBe(false)
    }
  })
})

describe('deploy purity', () => {
  it('deploy imports no React and no DOM-bound packages', () => {
    for (const f of sourceFiles(DEPLOY)) {
      const src = readFileSync(join(DEPLOY, f), 'utf8')
      expect(FORBIDDEN.test(src), `${f} imports a forbidden module`).toBe(false)
    }
  })
})
