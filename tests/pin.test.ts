import { describe, expect, test } from 'claude-code/testing'

import type { Anchor, TypedEntry } from '../hooks/core/entries'
import { pinComment } from '../hooks/core/pin'
import type { Copied, Sources } from '../hooks/core/pin'

// Which of the places a comment could be about wins, and what it says when none of them does.
// The order is a rule with many cases, so it is a table here rather than one behaviour each
// (6.3); what the person reads of it is in comments.test.tsx.

const QUOTE = 'revenue grew by twelve percent'
const FILE = '/proj/docs/report.md'
const HOLDS = `# Report\n\nThe ${QUOTE} in the third quarter.\n`

type Given = {
  clip?: Copied
  selected?: string
  files?: Record<string, string>
  found?: string[]
  named?: string
  output?: string
}

const sourcesOf = (given: Given): Sources => ({
  clipboard: () => Promise.resolve(given.clip ?? { text: '', isNew: false }),
  selection: () => Promise.resolve(given.selected ?? ''),
  read: file => Promise.resolve(given.files?.[file]),
  search: () => Promise.resolve(given.found ?? []),
  resolve: () => Promise.resolve(given.named),
  ...(given.output === undefined ? {} : { output: given.output }),
})

const comment = (anchor: Anchor = {}): TypedEntry => ({ kind: 'question', text: 'why this', anchor, raw: '+? why this' })

const pin = (given: Given, anchor?: Anchor) => pinComment(comment(anchor), '/proj', [FILE], sourcesOf(given))

describe('what a comment is about', () => {
  test('a place the comment names itself wins over anything copied', async () => {
    const given = { clip: { text: QUOTE, isNew: true }, files: { [FILE]: HOLDS }, named: FILE }

    expect(await pin(given, { file: 'report.md', line: 7 })).toEqual({ file: FILE, line: 7 })
  })

  test('a heading the comment names is looked for in the files seen, and says so when it is not there', async () => {
    const files = { [FILE]: HOLDS }

    expect(await pin({ files }, { heading: 'report' })).toEqual({ file: FILE, line: 1, heading: 'Report' })
    expect(await pin({ files }, { heading: 'results' })).toEqual({
      heading: 'results',
      note: 'no heading "results" in the 1 files written this session',
    })
  })

  test('a fresh clipboard is looked for first, and found in a file it is in', async () => {
    expect(await pin({ clip: { text: QUOTE, isNew: true }, files: { [FILE]: HOLDS } })).toEqual({
      file: FILE,
      line: 3,
      quote: QUOTE,
    })
  })

  test('with the clipboard unchanged, the text selected in the reply wins', async () => {
    const given = { clip: { text: QUOTE, isNew: false }, selected: 'the third quarter was quiet', files: { [FILE]: HOLDS } }

    expect(await pin(given)).toEqual({ quote: 'the third quarter was quiet', isLoose: true, from: 'terminal' })
  })

  test('with nothing selected, an older clipboard is used all the same', async () => {
    expect(await pin({ clip: { text: QUOTE, isNew: false }, files: { [FILE]: HOLDS } })).toEqual({
      file: FILE,
      line: 3,
      quote: QUOTE,
    })
  })

  test('copied text no file holds is kept as a loose quote, and says where it was looked for', async () => {
    expect(await pin({ clip: { text: QUOTE, isNew: true } })).toEqual({
      quote: QUOTE,
      isLoose: true,
      from: 'clipboard',
      note: 'copied text not found in any .md file under /proj',
    })
  })

  test('copied text too short to find says how short it was', async () => {
    expect(await pin({ clip: { text: 'grew a lot', isNew: true } })).toEqual({
      quote: 'grew a lot',
      isLoose: true,
      from: 'clipboard',
      note: 'copied text too short to find (3 words)',
    })
  })

  test('with nothing copied, the last tool output rides along, or the comment says why nothing was read', async () => {
    expect(await pin({ output: 'npm ERR! missing script' })).toEqual({ output: 'npm ERR! missing script', note: 'with the last tool output' })
    expect(await pin({})).toEqual({ note: 'no text on the clipboard' })
    expect(await pin({ clip: { text: '', isNew: false, missing: 'no clipboard reader here' } })).toEqual({ note: 'no clipboard reader here' })
  })
})
