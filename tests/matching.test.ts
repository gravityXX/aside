import { describe, expect, test } from 'claude-code/testing'

import { findTags } from '../hooks/core/entries'
import { findFragment, findHeading } from '../hooks/core/markdown'
import { REPORT } from './world'

// How a comment finds its place in a markdown file. These are matching rules with thresholds,
// so each case is a line of a table: the text, and the line it should land on (or none).

describe('finding a copied fragment', () => {
  test('a fragment copied from the preview lands on its line through markup, wraps and numbers', () => {
    const cases: [string, string, number | undefined][] = [
      ['Revenue grew by 12% in the third quarter, mostly thanks to the new pricing.', REPORT, 5],
      ['thanks to the new pricing', REPORT, 6],
      ['Costs stayed flat across all regions.', REPORT, 8],
      ['Install uv first.\nRun the tests.\nPush the branch.', '1. Install uv first.\n2. Run the tests.\n3. Push the branch.', 1],
      ['Write the report draft today', 'Notes\n\n- [x] Write the report draft today', 3],
      ['To start, run the following command in the root of the repository and wait for it', 'Intro.\n\nTo start, run the following command in the root of the repository and wait.', 3],
    ]
    for (const [quote, source, line] of cases) expect(findFragment(quote, source)).toBe(line)
  })

  test('too little evidence lands nowhere', () => {
    const source = 'Intro.\n\nTo start, run the following command in the root of the repository and wait.'
    const cases: [string, string][] = [
      ['Revenue', REPORT],
      ['Something written somewhere else entirely, not here at all', REPORT],
      ['npm run build', 'Run `npm run build` first.'],
      ['Elsewhere on the web: run the following command in the root of the repository, then open the browser and log in with your account', source],
    ]
    for (const [quote, text] of cases) expect(findFragment(quote, text)).toBeUndefined()
  })
})

describe('finding a heading', () => {
  test('a heading is found by the start of its slug, then by any part, with Polish letters folded', () => {
    expect(findHeading(REPORT, 'results')).toEqual({ line: 3, title: 'Results' })
    expect(findHeading(REPORT, 'zrodla')).toEqual({ line: 11, title: 'Źródła danych' })
    expect(findHeading(REPORT, 'danych')).toEqual({ line: 11, title: 'Źródła danych' })
  })

  test('a heading inside a code block is not a heading', () => {
    expect(findHeading(REPORT, 'not-a')).toBeUndefined()
    expect(findHeading('````\n```\n# fake\n```\n````\n# Real', 'fake')).toBeUndefined()
  })
})

describe('tags written in a file', () => {
  test('a tag is a comment with its line and the text above it', () => {
    expect(findTags(REPORT)).toEqual([{ kind: 'question', text: 'is this the same for Poland', line: 9, quote: 'Costs stayed flat across all regions.' }])
  })

  test('a tag shown as an example, in a code block or a code span, is not a comment', () => {
    expect(findTags('```md\n<!-- ? shown as an example -->\n```\nText\n<!-- - real -->')).toEqual([{ kind: 'drop', text: 'real', line: 5, quote: 'Text' }])
    expect(findTags('````md\n```\n<!-- ? inside -->\n```\n````\n<!-- ! outside -->')).toEqual([{ kind: 'change', text: 'outside', line: 6 }])
    expect(findTags('Write `<!-- ? question -->` above a line.')).toEqual([])
  })
})
