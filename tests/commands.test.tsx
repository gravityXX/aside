import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { REPORT, REPORT_PATH, world } from './world'

describe('/aside', () => {
  test('/aside alone lines the queue and the plan up in columns, and sends nothing', async ($, on) => {
    const { sent, type, aside, savePlan, idle } = world($, on)
    await type('+ a\n+? b')
    await savePlan([{ title: 'One', prompt: 'Do one.' }])

    expect(await aside()).toBe(
      [
        '1 idea and 1 comment waiting',
        '',
        '  1  idea      a',
        '  2  question  b',
        '',
        'Plan: 1 of 1 step to do (/aside run)',
        '',
        '  1  to do  One',
      ].join('\n'),
    )
    await idle()
    expect(sent).toEqual([])
  })

  test('/aside TEXT queues TEXT as + would, and answers with the line alone', async ($, on) => {
    const { toasts, logged, aside, shown } = world($, on)

    expect(await aside('add tests for the parser')).toBe('queued "add tests for the parser" (1 waiting)')
    expect(await aside('+? why this order')).toBe('queued ? "why this order" - no text on the clipboard (2 waiting)')
    expect(toasts).toEqual([])
    expect(logged).toEqual([])
    expect(await shown()).toEqual(['1 idea and 1 comment waiting', '1 idea add tests for the parser', '2 question why this order'])
  })

  test('a word that looks like a command but has the wrong shape is queued as text', async ($, on) => {
    const { sent, type, aside, idle } = world($, on)
    await type('+ a')

    expect(await aside('send a summary to the team')).toBe('queued "send a summary to the team" (2 waiting)')
    expect(await aside('run the tests before merge')).toBe('queued "run the tests before merge" (3 waiting)')
    expect(await aside('clear the cache docs')).toBe('queued "clear the cache docs" (4 waiting)')
    expect(await aside('+ run 3')).toBe('queued "run 3" (5 waiting)')
    await idle()
    expect(sent).toEqual([])
  })

  test('/aside scan FILE adds the tags of a file Claude did not write', async ($, on) => {
    const { aside, shown } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    expect(await shown()).toEqual(['The queue is empty.'])

    expect(await aside('scan docs/report.md')).toBe('docs/report.md: 1 tag; /aside includes the file from now on.')
    expect(await shown()).toEqual([
      'The queue is empty.',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })
})

describe('taking entries out', () => {
  test('/aside pop puts the newest entry in the box, ready to send; pop N takes entry N', async ($, on) => {
    const { filled, type, aside, shown } = world($, on)
    await type('+ a\n+? b\n+ c')

    expect(await aside('pop 2')).toBe('In the prompt box, ready to send: b')
    expect(await aside('pop')).toBe('In the prompt box, ready to send: c')
    expect(filled).toEqual(['Question:\nb', 'c'])
    expect(await aside('pop 9')).toBe('Give a number from 1 to 1, as /aside shows them.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea a'])
  })

  test('/aside remove N takes one entry out, and clear the rest', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+ a\n+ b\n+ c')

    expect(await aside('remove 2')).toBe('Removed: b')
    expect(await aside('rm 9')).toBe('Give a number from 1 to 2, as /aside list shows them.')
    expect(await aside('Clear')).toBe('Cleared 2 entries. /aside undo brings them back.')
    expect(await aside('clear')).toBe('The queue is already empty.')
  })

  test('/aside undo brings back what clear took, even after clearing an empty queue', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+ a\n+ b')
    await aside('clear')
    await aside('clear')

    expect(await aside('undo')).toBe('Brought back 2 entries, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea b'])
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })
})

describe('changing entries', () => {
  test('/aside edit N puts the entry in the box, and Enter brings it back to its place', async ($, on) => {
    const { filled, type, aside, shown } = world($, on)
    await type('+ a\n+ b\n+ c')

    expect(await aside('edit 2')).toBe(
      'Entry 2 is in the prompt box: change it and press Enter; it goes back to place 2, still pointing where it did.',
    )
    expect(filled).toEqual(['+ b'])
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea c'])
    await type('+ b again')
    expect(await shown()).toEqual(['3 ideas waiting', '1 idea a', '2 idea b again', '3 idea c'])
  })

  test('an edited comment still points where it did, whatever was copied since', async ($, on) => {
    const { w, write, type, aside, shown } = world($, on, { files: { [REPORT_PATH]: REPORT }, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)
    await type('+? where from')
    await type('+ b')

    await aside('edit 1')
    w.clip = 'Something else entirely, copied later from a web page'
    await type('+? where does 12% come from')
    expect(await shown()).toEqual([
      '1 idea and 1 comment waiting',
      '1 question where does 12% come from',
      '↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      '2 idea b',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
  })

  test('/aside move N M moves an entry, and a place out of range is refused', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+ a\n+ b\n+? c')

    expect(await shown('move 3 1')).toEqual(['2 ideas and 1 comment waiting', '1 question c', '2 idea a', '3 idea b'])
    expect(await aside('move 9 1')).toBe('Give two places from 1 to 3: /aside move 3 1')
  })
})

describe('the order setting', () => {
  const NEWEST = { options: { order: 'newest' } }

  test('newest first: the newest entry is 1, pop alone takes it, and numbers follow the list', NEWEST, async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+ alpha')
    await type('+ bravo')
    await type('+? charlie')

    expect(await shown()).toEqual(['2 ideas and 1 comment waiting', '1 question charlie', '2 idea bravo', '3 idea alpha'])
    expect(await aside('pop')).toBe('In the prompt box, ready to send: charlie')
    expect(await aside('remove 2')).toBe('Removed: alpha')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea bravo'])
  })

  test('newest first: an edited entry comes back to its place, and move follows the list', NEWEST, async ($, on) => {
    const { filled, type, aside, shown } = world($, on)
    await type('+ alpha\n+ bravo\n+ charlie')

    await aside('edit 2')
    expect(filled).toEqual(['+ bravo'])
    await type('+ bravo again')
    expect(await shown()).toEqual(['3 ideas waiting', '1 idea charlie', '2 idea bravo again', '3 idea alpha'])
    expect(await shown('move 3 1')).toEqual(['3 ideas waiting', '1 idea alpha', '2 idea charlie', '3 idea bravo again'])
  })

  test('newest first: run goes from the newest, and undo brings the list back as it was', NEWEST, async ($, on) => {
    const { sent, type, aside, shown, idle } = world($, on)
    await type('+ alpha\n+ bravo')

    expect(await aside('run all')).toBe('Sending 2 ideas.')
    await idle()
    expect(sent.at(-1)).toContain('Ideas:\n1. bravo (branch main)\n2. alpha (branch main)')
    expect(await aside('undo')).toBe('Brought back 2 entries, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea bravo', '2 idea alpha'])

    expect(await aside('run')).toBe('Running 2 entries one by one. /aside stop stops after the current one.')
    await idle()
    expect(sent.at(-1)).toBe('bravo (branch main)\n\n(Step 1 of 2 of the queue plan, "bravo", sent by the aside plugin.)')
  })
})

describe('tab completion', () => {
  const complete = ($: Engine, text: string) => {
    const token = /\S*$/.exec(text)![0]
    // The test kit's types leave this event out.
    const prompt = $.prompt as unknown as {
      autocomplete: (e: unknown) => Promise<{ suggestions: { text: string; description?: string }[] }>
    }

    return prompt
      .autocomplete({ text, cursor: text.length, token: token || text.slice(-1), start: text.length - token.length })
      .then(result => result.suggestions.map(row => `${row.text}: ${row.description ?? ''}`))
  }

  test('after "/aside " Tab offers the subcommands, then the entry numbers', async ($, on) => {
    const { type } = world($, on)
    on('prompt.autocomplete', () => ({ suggestions: [] }))
    await type('+ dark mode\n+? why so slow')

    expect(await complete($, '/aside cl')).toEqual(['clear: empty the queue'])
    expect(await complete($, '/aside p')).toEqual(['plan: organize the queue into steps', 'pop: put an entry in the box, ready to send'])
    expect(await complete($, '/aside pop ')).toEqual(['1: dark mode', '2: question: why so slow'])
    expect(await complete($, 'just text')).toEqual([])
  })
})
