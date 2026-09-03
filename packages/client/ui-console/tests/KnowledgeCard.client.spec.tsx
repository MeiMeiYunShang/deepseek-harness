// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeCard } from '../src/client/KnowledgeCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

describe('KnowledgeCard', () => {
  it('renders the empty hint when no sources are provided', () => {
    render(<KnowledgeCard t={t} />)
    expect(screen.getByText(en.knowledgeEmpty)).toBeTruthy()
  })

  it('renders each source row and the latest badge', () => {
    render(<KnowledgeCard t={t} items={[
      { id: 'a', name: 'Repo docs', latest: true },
      { id: 'b', name: 'Design notes', latest: false },
    ]} />)
    expect(screen.getByText('Repo docs')).toBeTruthy()
    expect(screen.getByText('Design notes')).toBeTruthy()
    expect(screen.getByText(en.knowledgeLatest)).toBeTruthy()
  })
})
