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
    await aside('run all')
    await idle()

    expect(await aside()).toBe(
      [
        'Plan: 3 of 3 steps to do (/aside run)',
        '',
        '  1  running  One',
        '  2  to do    Two',
        '  3  to do    Three',
        '',
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

    expect(await aside('add tests for the parser')).toBe('queued "add tests for the parser" · 1 waiting')
    expect(await aside('+? why this order')).toBe('queued ? "why this order" - no text on the clipboard · 2 waiting')
    expect(toasts).toEqual([])
    expect(logged).toEqual([])
    expect(await shown()).toEqual(['1 idea and 1 comment waiting', '1 idea add tests for the parser', '2 question why this order'])
  })

  test('a word that looks like a command but has the wrong shape is queued as text', async ($, on) => {
    const { sent, type, aside, idle } = world($, on)
    await type('+ a')

    expect(await aside('send a summary to the team')).toBe('queued "send a summary to the team" · 2 waiting')
    expect(await aside('run the tests before merge')).toBe('queued "run the tests before merge" · 3 waiting')
    expect(await aside('clear the cache docs')).toBe('queued "clear the cache docs" · 4 waiting')
    expect(await aside('+ run 3')).toBe('queued "run 3" · 5 waiting')
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
  test('/aside pop puts the first entry in the box, ready to send; pop N takes entry N', async ($, on) => {
    const { filled, type, aside, shown } = world($, on)
    await type('+ a\n+? b\n+ c')

    expect(await aside('pop 2')).toBe('In the prompt box, ready to send: b')
    expect(await aside('pop')).toBe('In the prompt box, ready to send: a')
    expect(filled).toEqual(['Question:\nb', 'a'])
    expect(await aside('pop 9')).toBe('Give a number from 1 to 1, as /aside shows them.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea c'])
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

  test('/aside undo run again after one the store refused half-way brings nothing back twice', async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ a')
    await aside('clear')
    w.refuseDelete = 1

    expect(await aside('undo')).toBe('/aside undo did not finish (the store is busy). /aside shows where the queue and the plan stand.')
    expect(await aside('undo')).toBe('Brought back 1 entry, 1 waiting.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea a'])
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

  test('newest first: plan and run go from the newest, and undo brings the list back as it was', NEWEST, async ($, on) => {
    const { sent, type, aside, shown, answer, idle } = world($, on)
    await type('+ alpha\n+ bravo')

    expect(await aside('plan')).toBe('Organizing 2 ideas.')
    await idle()
    expect(sent.at(-1)).toContain('Ideas:\n1. bravo (branch main)\n2. alpha (branch main)')
    expect(await aside('undo')).toBe('Brought back 2 entries, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea bravo', '2 idea alpha'])
    expect(await aside('pop')).toBe('In the prompt box, ready to send: bravo')
    await type('+ bravo')

    expect(await aside('run')).toBe('Running entry 1: bravo')
    await idle()
    expect(sent.at(-1)).toContain('(Step 1 of 1 of the queue plan, "bravo", sent by the aside plugin.)')
    await answer('n1')
    await type('+ bravo')

    expect(await aside('run all')).toBe('Running 2 entries one by one. /aside stop stops after the current one.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 1 of 2 of the queue plan, "bravo", sent by the aside plugin.\nPlan: 1 bravo (this one) · 2 alpha (to do).')
  })
})

describe('/aside help', () => {
  test('/aside help says what /aside undo brings back: a clear, or a plan or run Claude has not answered', async ($, on) => {
    const { aside } = world($, on)

    expect((await aside('help')).split('\n')).toContain('/aside undo - bring back what the last clear, or an unanswered plan or run, took')
  })

  test('while Claude works, /aside help opens in the pane, which goes back to the queue from there', async ($, on) => {
    const { panes, type, aside, startTurn, endTurn, pane } = world($, on)
    await startTurn('build it', 't1')
    await type('+ a', 't1')

    expect(await aside('help')).toBe('Opened the help in the pane while Claude was working.')
    expect(panes).toEqual(['aside'])
    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /\/aside stop - stop after the current step/ }))?.text).toContain('Queue an idea: start a message with "+".')
    await ui.press({ key: 'queue' })
    expect((await ui.find({ type: 'Text', text: /^a$/ }))?.text).toBe('a')
    await ui.unmount()

    await endTurn('t1')
    expect((await aside('help')).split('\n')).toContain('/aside stop - stop after the current step')
  })

  test('while Claude works and the terminal has no room for the pane, the help goes into the transcript at once', async ($, on) => {
    const { logged, aside, startTurn } = world($, on, { isNarrow: true })
    await startTurn('build it', 't1')

    expect(await aside('help')).toBe('Wrote the help above while Claude was working.')
    expect(logged.at(-1)?.split('\n')).toContain('/aside stop - stop after the current step')
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

  test('after "/aside q " Tab offers a queue of this project\'s as its own, hiding one of its name for every project, and its local and global', { options: { newQueues: 'local' } }, async ($, on) => {
    const { w, type, aside } = world($, on)
    on('prompt.autocomplete', () => ({ suggestions: [] }))
    await type('+@work here')
    w.root = '/other'
    await type('+@work for every project')
    await aside('q work global')
    await type('+@later elsewhere')
    w.root = '/proj'

    expect(await complete($, '/aside q ')).toEqual(["work: 1 idea, this project's"])
    expect(await complete($, '/aside q w')).toEqual(["work: 1 idea, this project's"])
    expect(await complete($, '/aside q work lo')).toEqual(['local: keep it for this project alone'])
    expect(await complete($, '/aside q work pop ')).toEqual(['1: here'])
  })

  test('after "/aside " Tab offers the subcommands, then the entry numbers', async ($, on) => {
    const { type } = world($, on)
    on('prompt.autocomplete', () => ({ suggestions: [] }))
    await type('+ dark mode\n+? why so slow')

    expect(await complete($, '/aside cl')).toEqual(['clear: empty the queue'])
    expect(await complete($, '/aside l')).toEqual(['list: show the queue and the plan', 'log: the plans run to their end'])
    expect(await complete($, '/aside f')).toEqual(['find: look for words in every queue and the plan'])
    expect(await complete($, '/aside i')).toEqual(['import: queue the items of a markdown list'])
    expect(await complete($, '/aside u')).toEqual(['undo: bring back what the last clear, or an unanswered plan or run, took'])
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
    expect(await complete($, '/aside g i')).toEqual(['import: put the items of a markdown list on it'])
    expect(await complete($, '/aside g here 1 ')).toEqual(['1: read the RFC', '2: learn Rust'])
    expect(await complete($, '/aside g r')).toEqual(['remove: remove ideas from the global list'])
    expect(await complete($, '/aside g remove 1 ')).toEqual(['1: read the RFC', '2: learn Rust'])
    expect(await complete($, '/aside g edit 1 ')).toEqual([])
    await type('+ dark mode\n+? why so slow')
    expect(await complete($, '/aside g add ')).toEqual(['1: dark mode'])
  })

  test('after "/aside q " Tab offers the queues with their size, then a queue\'s commands and its numbers', async ($, on) => {
    const { type } = world($, on)
    on('prompt.autocomplete', () => ({ suggestions: [] }))
    await type('+@work write the report\n+@work call the bank\n+@home water the plants\n+g read the RFC')

    expect(await complete($, '/aside q ')).toEqual(['global: 1 idea', 'home: 1 idea', 'work: 2 ideas'])
    expect(await complete($, '/aside q w')).toEqual(['work: 2 ideas'])
    expect(await complete($, '/aside q @wo')).toEqual(['work: 2 ideas'])
    expect(await complete($, '/aside q work r')).toEqual(['remove: remove ideas from it', 'rename: move all of it to a queue of another name'])
    expect(await complete($, '/aside q work remove 1 ')).toEqual(['1: write the report', '2: call the bank'])
    expect(await complete($, '/aside q work c')).toEqual(['clear: empty it'])
    expect(await complete($, '/aside q global r')).toEqual(['remove: remove ideas from the global list'])
    expect(await complete($, '/aside q home here ')).toEqual(['1: water the plants'])
    expect(await complete($, '/aside q WO')).toEqual(['work: 2 ideas'])
    expect(await complete($, '/aside q WORK r')).toEqual(['remove: remove ideas from it', 'rename: move all of it to a queue of another name'])
    expect(await complete($, '/aside g c')).toEqual(['clear: empty the global list'])
    expect(await complete($, '/aside g u')).toEqual(['undo: bring back what its last clear took'])
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
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('needs <your> yes & a name')
    await endTurn('s1')
    await idle()

    await aside('export')
    expect(w.files['/proj/aside.md']!.split('\n')[6]).toBe('## Plan waits at step 1 (needs &lt;your> yes & a name), 3 of 3 steps to do (/aside continue)')
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
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" · 1 waiting')
    await aside('export')
    await write('/proj/aside.md')

    expect(await queue('+? and this')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" · 2 waiting')
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
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" · 1 waiting')
    await aside('export')
    w.grep = `/proj/aside.md\n${REPORT_PATH}`

    expect(await queue('+? and this')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" · 2 waiting')
  })

  test('a copied fragment is found by a walk in its own file, not in an export that quotes it', async ($, on) => {
    const { queue, aside } = world($, on, { system: 'mac', files: { [REPORT_PATH]: REPORT }, clip: 'Revenue grew by 12% in the third quarter' })
    expect(await queue('+? where from')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" · 1 waiting')
    await aside('export')

    expect(await queue('+? and this')).toBe('queued ? docs/report.md:5 "Revenue grew by 12% in the th…" · 2 waiting')
  })
})

describe('finding entries', () => {
  test('/aside find looks in the queue, the tags, the plan, the global list and every named queue, with the numbers each shows', async ($, on) => {
    const { type, write, aside, shown, savePlan } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)
    await type('+ fix the login bug')
    await type('+ Dark mode for the pane')
    await type('+g dark mode later')
    await type('+@work Zrób ciemny tryb, dark')
    await savePlan([{ title: 'Docs', prompt: 'Write the docs.' }, { title: 'Theme', prompt: 'Add a DARK mode.' }])

    expect(await shown('find dark mode')).toEqual([
      'In the queue (/aside)',
      '2 idea Dark mode for the pane',
      'In the plan (/aside run N)',
      '2 to do Theme',
      'On the global list (/aside g)',
      '1 idea dark mode later',
    ])
    expect(await shown('find zrob')).toEqual(['In @work (/aside q work)', '1 idea Zrób ciemny tryb, dark'])
    expect(await shown('find poland')).toEqual(['Tags in files', '· question is this the same for Poland', '↳ docs/report.md:9 · "Costs stayed flat across all regions."'])
    // What an entry is about counts too: its quote and its file, as its row shows them.
    expect(await shown('find costs flat')).toEqual(['Tags in files', '· question is this the same for Poland', '↳ docs/report.md:9 · "Costs stayed flat across all regions."'])
    expect(await shown('find docs report')).toEqual(['Tags in files', '· question is this the same for Poland', '↳ docs/report.md:9 · "Costs stayed flat across all regions."'])
    expect(await aside('find proj')).toBe('Nothing holds "proj": not the queue, the tags, the plan, the global list or a named queue.')
  })

  test('/aside find says where it looked when nothing holds the words, and with order newest numbers as /aside does', { options: { order: 'newest' } }, async ($, on) => {
    const { type, aside, shown } = world($, on)
    await type('+ dark mode')
    await type('+ fix the login bug')

    expect(await shown('find login')).toEqual(['In the queue (/aside)', '1 idea fix the login bug'])
    expect(await aside('find nothing here')).toBe('Nothing holds "nothing here": not the queue, the tags, the plan, the global list or a named queue.')
    await type('+g read the RFC')
    await type('+g read the book')
    expect(await shown('find read')).toEqual(['On the global list (/aside g)', '1 idea read the book', '2 idea read the RFC'])
    expect(await aside('find !!')).toBe('Give words to look for: /aside find dark mode')
  })

  test('/aside find finds a step by what it said, leaves out the plugin\'s own words, and gives a plan done no number to run', async ($, on) => {
    const { write, type, aside, shown, savePlan, answer, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await savePlan([{ title: 'Theme', prompt: 'Add a dark mode.' }])
    await aside('run all')
    await idle()
    await answer('s1', 'Result: the colours are cached.')
    await type('+ fix the login bug')

    expect(await shown('find colours cached')).toEqual(['In the plan, done (/aside)', '1 done Theme', '↳ the colours are cached.'])
    await write(REPORT_PATH)
    await aside('run all')
    expect(await aside('find remove the tag')).toBe('Nothing holds "remove the tag": not the queue, the tags, the plan, the global list or a named queue.')
  })

  test('while Claude works on a narrow terminal, what /aside find finds goes into the transcript at once', async ($, on) => {
    const { logged, type, aside, startTurn } = world($, on, { isNarrow: true })
    await type('+ dark mode')
    await startTurn('build it', 't1')

    expect(await aside('find dark')).toBe('Wrote what was found above while Claude was working.')
    expect(logged.at(-1)).toBe(['In the queue (/aside)', '', '  1  idea  dark mode'].join('\n'))
  })
})

describe('importing a list', () => {
  const NOTES = [
    '---',
    'tags:',
    '  - project',
    '---',
    '# Notes',
    '',
    'A paragraph, no entry.',
    '',
    '- dark mode',
    '  - for the pane too',
    '- [ ] fix the login bug',
    '- [x] done already',
    '  - and its detail',
    '1. +? why is it slow',
    '* ++ the cache',
    '- +! a bigger font',
    '- +- the old flag',
    '+ try zellij',
    '2) ship it',
    'and run it on the way',
    '- [X] also done',
    '- [ ]',
    '',
    '* * *',
    '',
    '```',
    '- not this one',
    '```',
  ].join('\n')

  test('/aside import queues each item of a markdown list, its own lines with it and its mark giving its kind, and leaves the file as it was', async ($, on) => {
    const { w, filled, aside, shown } = world($, on, { files: { '/proj/notes.md': NOTES } })

    expect(await aside('import notes.md')).toBe('Imported 4 ideas and 4 comments from notes.md, 8 waiting. Left out: 2 ticked.')
    expect(await shown()).toEqual([
      '4 ideas and 4 comments waiting',
      '1 idea dark mode',
      '- for the pane too',
      '2 idea fix the login bug',
      '3 question why is it slow',
      '4 dig deeper the cache',
      '5 change a bigger font',
      '6 drop the old flag',
      '7 idea try zellij',
      '8 idea ship it',
      'and run it on the way',
    ])
    expect(w.files['/proj/notes.md']).toBe(NOTES)
    expect(await aside('edit 4')).toBe('Entry 4 is in the prompt box: change it and press Enter; it goes back to place 4, still pointing where it did.')
    expect(filled.at(-1)).toBe('++ the cache')
    await aside('pop 4')
    expect(await aside('edit 3')).toBe('Entry 3 is in the prompt box: change it and press Enter; it goes back to place 3, still pointing where it did.')
    expect(filled.at(-1)).toBe('+? why is it slow')
  })

  test('an import made again adds nothing twice', async ($, on) => {
    const { aside, shown } = world($, on, { files: { '/proj/notes.md': NOTES } })
    await aside('import notes.md')

    expect(await aside('import notes.md')).toBe('Nothing new in notes.md: its items are in the queue already. Left out: 2 ticked.')
    expect((await shown())[0]).toBe('4 ideas and 4 comments waiting')
  })

  test('an import counts apart what the queue holds already and what the file repeats, and kinds count as well as words', async ($, on) => {
    const { type, aside, shown } = world($, on, { files: { '/proj/notes.md': '- a\n- x\n- x\n- +? a' } })
    await type('+ a')

    expect(await aside('import notes.md')).toBe('Imported 1 idea and 1 comment from notes.md, 3 waiting. Left out: 1 already in the queue, 1 repeated in the file.')
    expect(await shown()).toEqual(['2 ideas and 1 comment waiting', '1 idea a', '2 idea x', '3 question a'])
  })

  test('an item of several lines comes back whole after /aside edit, here and on the global list', async ($, on) => {
    const notes = ['- run the tool', '  -v for more', '  -q for less', '- dark mode', '  + for the pane too', '- ', '  under an empty item'].join('\n')
    const { sent, filled, type, aside, shown } = world($, on, { files: { '/proj/notes.md': notes } })
    await aside('import notes.md')
    expect(await shown()).toEqual([
      '3 ideas waiting',
      '1 idea run the tool; -v for more; -q for less',
      '2 idea dark mode',
      '- for the pane too',
      '3 idea under an empty item',
    ])

    for (const n of [1, 2]) {
      await aside(`edit ${n}`)
      await type(filled.at(-1)!)
    }
    expect(sent).toEqual([])
    expect((await shown()).slice(1, 4)).toEqual(['1 idea run the tool; -v for more; -q for less', '2 idea dark mode', '- for the pane too'])

    await aside('g import notes.md')
    await aside('g edit 2')
    await type(filled.at(-1)!)
    expect(await shown('g')).toEqual(['3 ideas on the global list', '1 idea run the tool; -v for more; -q for less', '2 idea dark mode', '- for the pane too', '3 idea under an empty item'])
    expect((await shown())[0]).toBe('3 ideas waiting')
  })

  test('an import updates the line above the prompt at once, here and on the global list', async ($, on) => {
    const { type, aside, band } = world($, on, { files: { '/proj/notes.md': '- dark mode\n- try zellij' } })
    await type('+ local work')
    const read = async () => {
      const ui = await band()
      const text = (await ui.find({ type: 'Text', text: /^aside: / }))?.text
      await ui.unmount()
      return text
    }

    await aside('import notes.md')
    expect(await read()).toBe('aside: 3 ideas · ')
    await aside('g import notes.md')
    expect(await read()).toBe('aside: 3 ideas, 2 in another queue · ')
  })

  test('/aside import refuses an aside export, a file it cannot read, one with no list and one of more than 100 items', async ($, on) => {
    const big = Array.from({ length: 101 }, (_, i) => `- item ${i + 1}`).join('\n')
    const { type, aside, shown } = world($, on, { files: { '/proj/plain.md': '# Title\n\nJust text.', '/proj/big.md': big } })
    await type('+ dark mode')
    await aside('export')

    expect(await aside('import aside.md')).toBe('aside.md is an aside export; /aside import takes a list of your own.')
    expect(await aside('import nope.md')).toBe('Cannot read nope.md.')
    expect(await aside('import plain.md')).toBe('plain.md holds no list items to import.')
    expect(await aside('import big.md')).toBe('big.md holds 101 list items; /aside import takes 100 at most.')
    // Words that name no markdown file are an idea, as before.
    await aside('import the notes from the meeting')
    expect((await shown()).slice(0, 3)).toEqual(['2 ideas waiting', '1 idea dark mode', '2 idea import the notes from the meeting'])
  })

  test('an import while a typed entry is being stored waits for it, so neither writes over the other', async ($, on) => {
    const { w, clock, aside, shown, idle } = world($, on, { files: { '/proj/notes.md': '- a\n- b' } })
    let imported: Promise<string> | undefined
    w.beforeWrite = async key => {
      if (!key.startsWith('queue:')) return
      w.beforeWrite = undefined
      // The import comes while the typed entry's write is on its way, and has every chance to
      // write first: the typed entry's write goes on once the import is done, or as late as can be.
      let isDone = false
      imported = aside('import notes.md')
      void imported.then(() => (isDone = true))
      for (let i = 0; i < 2000 && !isDone; i++) await Promise.resolve()
    }
    await $.prompt.submit({ text: '+ typed meanwhile', origin: { kind: 'composer' }, wait: false })
    await clock.advance(2)
    await clock.settle()

    expect(await imported).toBe('Imported 2 ideas from notes.md, 3 waiting.')
    await idle()
    expect(await shown()).toEqual(['3 ideas waiting', '1 idea typed meanwhile', '2 idea a', '3 idea b'])
  })
})
