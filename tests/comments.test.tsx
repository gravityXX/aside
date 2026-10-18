import { describe, expect, test } from 'claude-code/testing'

import { REPORT, REPORT_PATH, world } from './world'

const REPORT_FILES = { [REPORT_PATH]: REPORT }

describe('where a comment points', () => {
  test('a comment lands on the fragment copied from a file Claude wrote', async ($, on) => {
    const { write, queue, shown } = world($, on, { files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)

    expect(await queue('+? where does this come from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    expect(await shown()).toEqual([
      '1 comment waiting',
      '1 question where does this come from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('a draft that ends with a mark takes what was copied too', async ($, on) => {
    const { write, queue, type, shown } = world($, on, { files: REPORT_FILES, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)

    expect(await queue('where does this number come from +?')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    expect(await type('and this one goes to Claude')).not.toEqual({ drop: 'queued' })
    expect(await shown()).toEqual([
      '1 comment waiting',
      '1 question where does this number come from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('copied text that no file holds is kept loose, and the comment says so', async ($, on) => {
    const { queue, shown } = world($, on, { files: { '/proj/old.md': REPORT }, clip: 'nothing like this is written anywhere at all' })

    expect(await queue('+! make it shorter')).toBe(
      'queued ! "nothing like this is written…" - copied text not found in any .md file under /proj (1 waiting)',
    )
    expect(await shown()).toEqual(['1 comment waiting', '1 change make it shorter', '↳ not in a file · "nothing like this is written anywhere at all"'])
  })

  test('grep finds the copied text in a file from an earlier session, list numbers and all', async ($, on) => {
    const { w, queue } = world($, on, { files: { '/proj/old.md': REPORT }, clip: 'Costs stayed flat across all regions.', grep: '/proj/old.md\n' })

    expect(await queue('+- drop this')).toBe('queued - old.md:8 "Costs stayed flat across all…" (1 waiting)')
    w.clip = '1. Costs stayed flat\n2. across all regions.'
    expect(await queue('+? a list copied with its numbers')).toBe('queued ? old.md:8 "1. Costs stayed flat 2. acros…" (2 waiting)')
  })

  test('on a Mac, pbpaste reads the clipboard and a walk finds the file BSD grep cannot', async ($, on) => {
    const { queue } = world($, on, {
      files: { '/proj/notes/deep/old.md': REPORT, '/proj/node_modules/x/old.md': REPORT, '/proj/.git/old.md': REPORT },
      clip: 'Costs stayed flat across all regions.',
      system: 'mac',
    })

    expect(await queue('+- drop this')).toBe('queued - notes/deep/old.md:8 "Costs stayed flat across all…" (1 waiting)')
    expect(await queue('+? @old.md where')).toBe('queued ? notes/deep/old.md:8 "Costs stayed flat across all…" (2 waiting)')
  })

  test('with nothing copied, a comment points nowhere and says so', async ($, on) => {
    const { queue, shown } = world($, on)

    expect(await queue('+? and this')).toBe('queued ? "and this" - no text on the clipboard (1 waiting)')
    expect(await shown()).toEqual(['1 comment waiting', '1 question and this'])
  })

  test('a heading or a line named after the mark needs no clipboard', async ($, on) => {
    const { write, queue } = world($, on, { files: REPORT_FILES })
    await write(REPORT_PATH)

    expect(await queue('+- #zrodla')).toBe('queued - docs/report.md:11 (1 waiting)')
    expect(await queue('+? @docs/report.md:3 why this order')).toBe('queued ? docs/report.md:3 (2 waiting)')
    expect(await queue('+! @docs/report.md#results shorter')).toBe('queued ! docs/report.md:3 (3 waiting)')
    expect(await queue('@docs/report.md:5 where from +?')).toBe('queued ? docs/report.md:5 (4 waiting)')
    expect(await queue('+! #nowhere shorter')).toBe('queued ! #nowhere - no heading "nowhere" in the 1 files written this session (5 waiting)')
  })

  test("a fresh copy comes first; with the clipboard unchanged, the selection in Claude's reply wins", async ($, on) => {
    const { w, write, queue, shown } = world($, on, {
      files: REPORT_FILES,
      clip: 'Costs stayed flat across all regions.',
      selection: 'Revenue grew by 12% in the third quarter',
    })
    await write(REPORT_PATH)

    expect(await queue('+? why flat')).toBe('queued ? docs/report.md:8 "Costs stayed flat across all…" (1 waiting)')
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (2 waiting)')
    w.selection = 'I chose the async path because the sync one blocks'
    await queue('+! use the sync path')
    expect(await shown()).toEqual([
      '3 comments waiting',
      '1 question why flat',
      '↳ docs/report.md:8 · "Costs stayed flat across all regions."',
      '2 question where from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      '3 change use the sync path',
      '↳ terminal · "I chose the async path because the sync one blocks"',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })
})

describe('the tool output a comment comes with', () => {
  test('only what Bash and the edit tools printed counts, not a denial or a missing file', async ($, on) => {
    const { queue, shown, startTurn } = world($, on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: '3 tests failed' }) as never)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'File does not exist', isError: true }) as never)
    await startTurn('test it', 't1')
    await $.tool.call({ tool: 'Read', file_path: '/proj/nope.md' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/proj/nope2.md' } as never)

    await queue('+? why')
    expect(await shown()).toEqual(['1 comment waiting', '1 question why', '↳ after Bash · 3 tests failed'])
  })

  test('with nothing copied, a comment takes the last tool output of its turn, an error first', async ($, on) => {
    const { queue, shown, startTurn } = world($, on)
    on('tool.call', { tool: 'Bash' }, ($e, e) => (e.command === 'fail' ? { result: 'exit 1: boom', isError: true } : { result: 'ok' }) as never)
    await startTurn('build it', 't1')
    await $.tool.call({ tool: 'Bash', command: 'fail' } as never)
    await $.tool.call({ tool: 'Bash', command: 'pass' } as never)

    expect(await queue('+? why did it fail')).toBe('queued ? "why did it fail" - with the last tool output (1 waiting)')
    expect(await shown()).toEqual(['1 comment waiting', '1 question why did it fail', '↳ after Bash failed · exit 1: boom'])

    await startTurn('next thing', 't2')
    expect(await queue('+? and now')).toBe('queued ? "and now" - no text on the clipboard (2 waiting)')
  })
})
