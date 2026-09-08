import { describe, expect, it } from 'vitest'
import { en, zh, NS } from '../src/client/locales.ts'

describe('console locales', () => {
  it('declares the console namespace and complete English and Chinese dictionaries', () => {
    expect(NS).toBe('console')
    expect(Object.keys(en)).toHaveLength(Object.keys(zh).length)
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(typeof zh[key], `zh[${key}]`).toBe('string')
      expect(en[key].length).toBeGreaterThan(0)
    }
  })
})
