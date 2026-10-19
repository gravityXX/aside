import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { REPORT, REPORT_PATH, STEPS, world } from './world'

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

  test('what an entry is about, a second line and the step states each keep to their column', async ($, on) => {
    const { write, type, aside, savePlan, idle } = world($, on, { files: { [REPORT_PATH]: REPORT }, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)
    await type('+ a\nsecond line')
    await type('+? where from')
    await savePlan(STEPS)
    await aside('run')
    await idle()

    expect(await aside()).toBe(
      [
        '1 idea and 1 comment waiting',
        '',
        '  1  idea      a',
        '               second line',
        '  2  question  where from',
        '               ↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
        '',
        'Tags in files',
        '',
        '  ·  question  is this the same for Poland',
        '               ↳ docs/report.md:9 · "Costs stayed flat across all regions."',
        '',
        'Plan: 3 of 3 steps to do (/aside run)',
        '',
        '  1  running  One',
        '  2  to do    Two',
        '  3  to do    Three',
      ].join('\n'),
    )
  })

  test('while Claude works, /aside opens the list in the pane, since its own output shows only after the turn', async ($, on) => {
    const { panes, type, aside, startTurn, endTurn, pane } = world($, on)
    await startTurn('build it', 't1')
    await type('+ a', 't1')

    expect(await aside()).toBe('Opened the list in the pane while Claude was working.')
    expect(panes).toEqual(['aside'])
    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /^a$/ }))?.text).toBe('a')
    await ui.unmount()

    await endTurn('t1')
    expect(await aside()).toBe('1 idea waiting\n\n  1  idea  a')
  })

  test('while Claude works and the terminal has no room for the pane, the list goes into the transcript at once', async ($, on) => {
    const { logged, type, aside, startTurn } = world($, on, { isNarrow: true })
    await startTurn('build it', 't1')
    await type('+ a', 't1')

    expect(await aside('list')).toBe('Wrote the list above while Claude was working.')
    expect(logged.at(-1)).toBe('1 idea waiting\n\n  1  idea  a')
  })

  test('/aside list and /aside ls show what /aside alone shows', async ($, on) => {
    const { type, aside } = world($, on)
    await type('+ a')

    expect(await aside('list')).toBe(await aside())
    expect(await aside('ls')).toBe(await aside())
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

  test('/aside remove takes several entries out at once, or none when a number is out of range', async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+ a\n+ b\n+ c\n+ d')

    expect(await aside('remove 1 9')).toBe('Give numbers from 1 to 4, as /aside list shows them.')
    expect(await aside('remove 3 1 3')).toBe('Removed 2 entries: a; c')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea b', '2 idea d'])
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
    expect(await shown()).toEqual(['2 ideas and 1 comment waiting', '1 question c', '2 idea a', '3 idea b'])
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
    expect(await shown()).toEqual(['3 ideas waiting', '1 idea alpha', '2 idea charlie', '3 idea bravo again'])
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
    expect(sent.at(-1)).toContain('(Step 1 of 2 of the queue plan, "bravo", sent by the aside plugin.\nPlan: 1 bravo (this one) · 2 alpha (to do).')
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
    expect(await complete($, '/aside remove 1 ')).toEqual(['1: dark mode', '2: question: why so slow'])
    expect(await complete($, '/aside pop 1 ')).toEqual([])
    expect(await complete($, '/aside run 2 ')).toEqual(['1: dark mode', '2: question: why so slow'])
    expect(await complete($, 'just text')).toEqual([])
  })

  test('after "/aside g " Tab offers its commands, then the numbers each takes', async ($, on) => {
    const { type } = world($, on)
    on('prompt.autocomplete', () => ({ suggestions: [] }))
    await type('+g read the RFC\n+g learn Rust')

    expect(await complete($, '/aside g h')).toEqual(['here: move global ideas into this queue'])
    expect(await complete($, '/aside g here 1 ')).toEqual(['1: read the RFC', '2: learn Rust'])
    expect(await complete($, '/aside g r')).toEqual(['remove: remove ideas from the global list'])
    expect(await complete($, '/aside g remove 1 ')).toEqual(['1: read the RFC', '2: learn Rust'])
    expect(await complete($, '/aside g edit 1 ')).toEqual([])
    await type('+ dark mode\n+? why so slow')
    expect(await complete($, '/aside g add ')).toEqual(['1: dark mode'])
  })
})

describe('exporting the list', () => {
  test('/aside export writes what /aside shows to aside.md as Markdown, and the queue stays', async ($, on) => {
    const { w, write, type, aside, shown, savePlan } = world($, on, {
      files: { [REPORT_PATH]: REPORT },
      clip: 'Revenue grew by 12% in the third quarter',
    })
    await write(REPORT_PATH)
    await type('+ keep <!-- ? this --> as text\n  and a second line')
    await type('+? where from')
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    const before = await shown()

    expect(await aside('export')).toBe('Exported 1 idea and 1 comment, 1 tag and the plan of 1 step to aside.md.')
    expect(w.files['/proj/aside.md']!.split('\n')).toEqual([
      '<!-- aside export -->',
      '',
      '# aside',
      '',
      'Exported 1970-01-01 00:00 UTC.',
      '',
      '## 1 idea and 1 comment waiting',
      '',
      '```text',
      '  1  idea      keep <!-- ? this --> as text',
      '                 and a second line',
      '  2  question  where from',
      '               ↳ docs/report.md:5 · "Revenue grew by 12% in the third quarter"',
      '```',
      '',
      '## Tags in files',
      '',
      '```text',
      '  ·  question  is this the same for Poland',
      '               ↳ docs/report.md:9 · "Costs stayed flat across all regions."',
      '```',
      '',
      '## Plan: 1 of 1 step to do (/aside run)',
      '',
      '```text',
      '  1  to do  One',
      '```',
      '',
    ])
    expect(await shown()).toEqual(before)
  })

  test('/aside export FILE writes there, over an earlier export but never over another file', async ($, on) => {
    const { w, type, aside } = world($, on, { files: { '/proj/notes.md': '# My notes' } })
    await type('+ a')

    expect(await aside('export notes/queue.md')).toBe('Exported 1 idea to notes/queue.md.')
    await type('+ b')
    expect(await aside('export notes/queue.md')).toBe('Exported 2 ideas to notes/queue.md.')
    expect(w.files['/proj/notes/queue.md']).toContain('  2  idea  b')
    expect(await aside('export notes.md')).toBe('notes.md is not an aside export; name another file: /aside export FILE')
    expect(w.files['/proj/notes.md']).toBe('# My notes')
  })

  test('a heading keeps the words Claude gave it, as typed', async ($, on) => {
    const { w, sent, aside, savePlan, startTurn, endTurn, wait, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('needs <your> yes & a name')
    await endTurn('s1')
    await idle()

    await aside('export')
    expect(w.files['/proj/aside.md']!.split('\n')[8]).toBe('## Plan paused after step 1 (needs &lt;your> yes & a name), 2 of 3 steps to do (/aside continue)')
  })

  test('code and backticks in an entry stay as typed: no fence in it closes the block it is in', async ($, on) => {
    const { w, type, aside } = world($, on)
    await type(['+ this fails:', '````', 'use <div> and ``` here', '````'].join('\n'))

    expect(await aside('export')).toBe('Exported 1 idea to aside.md.')
    expect(w.files['/proj/aside.md']!.split('\n').slice(8)).toEqual([
      '`````text',
      '  1  idea  this fails:',
      '           ````',
      '           use <div> and ``` here',
      '           ````',
      '`````',
      '',
    ])
  })

  test('/aside export takes a full path, in the project or out of it, on Windows too', async ($, on) => {
    const { w, type, aside } = world($, on)
    await type('+ a')

    expect(await aside('export /proj/out/list.md')).toBe('Exported 1 idea to out/list.md.')
    expect(await aside('export /tmp/list.md')).toBe('Exported 1 idea to /tmp/list.md.')
    expect(Object.keys(w.files)).toEqual(['/proj/out/list.md', '/tmp/list.md'])
  })

  test('on Windows, /aside export takes a path with backslashes, but none without its drive', async ($, on) => {
    const { w, type, aside } = world($, on, { system: 'windows' })
    await type('+ a')

    expect(await aside('export C:\\proj\\out\\list.md')).toBe('Exported 1 idea to out/list.md.')
    for (const name of ['/c/Users/me/notes.md', '\\notes.md', 'D:notes.md', 'notes:v2.md']) {
      expect(await aside(`export ${name}`)).toBe(`${name} is not a full Windows path; name the file in the project or with its drive, such as C:\\notes\\queue.md.`)
    }
    expect(Object.keys(w.files)).toEqual(['/proj/out/list.md'])
  })

  test('/aside export refuses a path it would put in the wrong place, and a sentence is queued', async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ a')

    for (const name of ['~/notes.md', '$HOME/notes.md', '%USERPROFILE%\\notes.md']) {
      expect(await aside(`export ${name}`)).toBe('Name a file in the project or by its full path, as ~, $HOME and %USERPROFILE% are not expanded: /aside export notes/queue.md')
    }
    for (const name of ['C:\\notes.md', 'notes\\queue.md']) {
      expect(await aside(`export ${name}`)).toBe(`${name} is spelled as on Windows; name the file as this system does, such as notes/queue.md.`)
    }
    expect(Object.keys(w.files)).toEqual([])
    await aside('export the notes to report.md')
    expect((await shown()).slice(-1)).toEqual(['2 idea export the notes to report.md'])
  })

  test('an export is no file to read tags from, nor one a copied fragment comes from', async ($, on) => {
    const { write, queue, aside, shown } = world($, on, { files: { [REPORT_PATH]: REPORT }, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    await aside('export')
    await write('/proj/aside.md')

    expect(await queue('+? and this')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (2 waiting)')
    expect(await aside('scan aside.md')).toBe('aside.md is an aside export; its tags are read from the files it lists.')
    expect((await shown()).filter(line => line.startsWith('·'))).toEqual(['· question is this the same for Poland'])
  })

  test('a tag in an exported entry is no tag in the list, whatever its number', async ($, on) => {
    const { write, type, aside, shown } = world($, on)
    for (let i = 1; i <= 9; i++) await type(`+ idea ${i}`)
    await type(['+ the tag looks like this:', '```', '<!-- ? why -->', '```'].join('\n'))
    await aside('export')
    await write('/proj/aside.md')

    expect((await shown()).some(line => line.startsWith('Tags in files'))).toBe(false)
  })

  test('with nothing to export, or a disk that refuses the write, /aside export says so', async ($, on) => {
    const { w, type, aside } = world($, on)

    expect(await aside('export')).toBe('Nothing to export: the queue is empty.')
    expect(w.files['/proj/aside.md']).toBeUndefined()
    await type('+ a')
    w.isReadOnly = true
    expect(await aside('export')).toBe('Could not write aside.md: EACCES: permission denied.')
  })

  test('a copied fragment is found by grep in its own file, not in an export that quotes it', async ($, on) => {
    const { w, queue, aside } = world($, on, { files: { [REPORT_PATH]: REPORT }, grep: REPORT_PATH, clip: 'Revenue grew by 12% in the third quarter' })
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    await aside('export')
    w.grep = `/proj/aside.md\n${REPORT_PATH}`

    expect(await queue('+? and this')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (2 waiting)')
  })

  test('a copied fragment is found by a walk in its own file, not in an export that quotes it', async ($, on) => {
    const { queue, aside } = world($, on, { system: 'mac', files: { [REPORT_PATH]: REPORT }, clip: 'Revenue grew by 12% in the third quarter' })
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (1 waiting)')
    await aside('export')

    expect(await queue('+? and this')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" (2 waiting)')
  })
})
