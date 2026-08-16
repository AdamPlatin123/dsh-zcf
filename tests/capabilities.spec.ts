import { describe, expect, it } from 'vitest'
import { CAPABILITIES, capabilityOf, parseWithList } from '../src/capabilities.ts'

describe('capabilities catalog', () => {
  it('lists a known set of ids without duplicates', () => {
    const ids = CAPABILITIES.map(capability => capability.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('exa')
    expect(ids).toContain('mcp')
  })

  it('declares packages, rows, and keys for every capability', () => {
    for (const capability of CAPABILITIES) {
      expect(capability.label['zh-CN']).toBeTruthy()
      expect(capability.label.en).toBeTruthy()
      expect((capability.packages?.length ?? 0) + (capability.rows?.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('sqlite replaces the default jsonl row', () => {
    expect(capabilityOf('sqlite')?.disableRows).toEqual(['session-persistence-jsonl'])
  })

  it('env-keyed providers name their credential references', () => {
    expect(capabilityOf('exa')?.envKeys).toEqual(['EXA_API_KEY'])
    expect(capabilityOf('perplexity')?.envKeys).toEqual(['PERPLEXITY_API_KEY'])
  })
})

describe('parseWithList', () => {
  it('splits, trims, and deduplicates', () => {
    expect(parseWithList('exa, terminal ,exa')).toEqual(['exa', 'terminal'])
    expect(parseWithList(undefined)).toEqual([])
    expect(parseWithList('  ')).toEqual([])
  })

  it('rejects unknown ids loudly, naming the known set', () => {
    expect(() => parseWithList('exa,bogus')).toThrow(/bogus/)
    expect(() => parseWithList('bogus')).toThrow(/known: /)
  })
})
