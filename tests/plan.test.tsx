import { describe, expect, test } from 'claude-code/testing'

import { ALONE, answering, asks, last, MARKER, NEXT, REPORT, REPORT_PATH, STEPS, WAITS, world } from './world'

describe('handing the queue over', () => {
  test('/aside plan sends the queue as one planning prompt: ideas, then comments by file', async ($, on) => {
    const { w, sent, write, type, aside, startTurn, idle } = world($, on, {
      files: { [REPORT_PATH]: REPORT },
      clip: 'Revenue grew by 12% in the third quarter',
    })
    await write(REPORT_PATH)
    await type('build the parser')
    await startTurn('build the parser', 't1')
    await type('+ dark mode', 't1')
    await type('+? where from', 't1')
    w.clip = ''
    await type('+! shorter', 't1')

    expect(await aside('plan')).toBe('Organizing 1 idea and 3 comments.')
    await idle()
    expect(sent.at(-1)).toBe(
      [
        'My queue, collected while you were working, oldest first.',
        '',
        'Ideas:',
        '1. dark mode (while you worked on "build the parser", branch main)',
        '',
        'Comments on what you wrote (question, change, drop, dig deeper):',
        'docs/report.md:',
        '  2. [question] line 5, on "Revenue grew by 12% in the third quarter": where from',
        '  4. [question] line 9, on "Costs stayed flat across all regions." [a <!-- --> tag in the file]: is this the same for Poland',
        'Not tied to a file:',
        '  3. [change]: shorter',
        '',
        'Organize all of it, and only organize it: do none of it and answer none of it yet. Use no tool but the mcp__aside__plan tool, so read nothing, run nothing and change nothing.',
        '- merge related items into one step and keep unrelated ones apart; a question is an item like any other, answered when its step runs;',
        '- order the steps so whatever the rest depends on comes first, and say why in a few words;',
        '- for each step, write a prompt I could send you as it is; it must stand on its own, file paths included;',
        '- leave items that look done, contradictory or unclear out of the steps: pass each to the tool as unclear, with its number and your question, and they go back to my queue;',
        '- when a step handles a comment that is a <!-- --> tag in a file, the step removes that tag.',
        'Then save the steps with the mcp__aside__plan tool and stop: I see the saved plan in a frame and run it with /aside run all (in order), /aside run (the next step) or /aside run N.',
        '',
        MARKER,
      ].join('\n'),
    )
  })

  test('on Windows, comments an earlier release stored under two spellings of one file are one group of the plan', async ($, on) => {
    const stored = {
      'queue:C:\\proj': [
        { text: 'where from', at: 1, kind: 'question', file: 'C:\\proj\\docs\\report.md', line: 5 },
        { text: 'and this', at: 2, kind: 'question', file: 'c:\\Proj/docs\\Report.md', line: 8 },
      ],
    }
    const { sent, aside, shown, idle } = world($, on, { system: 'windows', stored })

    expect(await shown()).toEqual(['2 comments waiting', '1 question where from', '↳ docs/report.md:5', '2 question and this', '↳ docs/Report.md:8'])
    expect(await aside('plan')).toBe('Organizing 2 comments.')
    await idle()
    const lines = sent.at(-1)!.split('\n')
    const start = lines.indexOf('Comments on what you wrote (question, change, drop, dig deeper):')
    expect(lines.slice(start + 1, lines.indexOf('', start))).toEqual(['docs/report.md:', '  1. [question] line 5: where from', '  2. [question] line 8: and this'])
  })

  test('on Windows, a tag an earlier release handed over under another spelling of its file stays handed over', async ($, on) => {
    const stored = { 'handed:C:\\proj': ['C:\\proj\\docs\\report.md\u0000is this the same for Poland'] }
    const { write, aside, shown } = world($, on, { system: 'windows', files: { 'C:\\proj\\docs\\report.md': REPORT }, stored })
    await write('C:\\proj\\docs\\report.md')

    expect(await aside('plan')).toBe('The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.')
    expect((await shown()).at(-1)).toBe('↳ docs/report.md:9 · "Costs stayed flat across all regions." · handed over')
  })

  test('undo counts each of two tags with the same text in one file', async ($, on) => {
    const notes = ['# Notes', '<!-- ? why -->', '', '<!-- ? why -->'].join('\n')
    const { write, aside, idle } = world($, on, { files: { '/proj/notes.md': notes } })
    await write('/proj/notes.md')
    expect(await aside('plan')).toBe('Organizing 2 comments.')
    await idle()

    expect(await aside('undo')).toBe('Brought back 2 tags, 2 waiting.')
  })

  test('on Windows, undo brings back once a tag an earlier release took under two spellings of its file', async ($, on) => {
    const tag = 'is this the same for Poland'
    const stored = {
      'takenTags:C:\\proj': [`C:\\proj\\docs\\report.md\u0000${tag}`, `c:\\proj/docs\\report.md\u0000${tag}`],
      'takenBy:C:\\proj': 'hand-over',
      'handed:C:\\proj': [`C:\\proj\\docs\\report.md\u0000${tag}`, `c:\\proj/docs\\report.md\u0000${tag}`],
    }
    const { write, aside } = world($, on, { system: 'windows', files: { 'C:\\proj\\docs\\report.md': REPORT }, stored })
    await write('C:\\proj\\docs\\report.md')

    expect(await aside('undo')).toBe('Brought back 1 tag, 1 waiting.')
    expect(await aside('plan')).toBe('Organizing 1 comment.')
  })

  test('with no plan, /aside run runs the first entry alone, and the rest waits in the queue', async ($, on) => {
    const { sent, type, aside, shown, answer, idle } = world($, on)
    await type('+ a\n+? b')

    expect(await aside('run')).toBe('Running entry 1: a')
    await idle()
    expect(sent).toEqual(['a (branch main)\n\n(Step 1 of 1 of the queue plan, "a", sent by the aside plugin.)'])
    await answer('e1')
    expect(await shown()).toEqual(['1 comment waiting', '1 question b', 'Plan done: 1 step', '1 done a'])

    expect(await aside('run')).toBe('Running entry 1: b')
    await idle()
    expect(sent.at(-1)).toContain('Question:\nb')
    await answer('e2')
    expect(await aside('run')).toBe('Nothing to run: the queue is empty and the plan is done.')
  })

  test('with only tags in files, /aside run says that run all runs them', async ($, on) => {
    const { sent, write, aside, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)

    expect(await aside('run')).toBe('The queue is empty; /aside run all runs the 1 tag in files.')
    await idle()
    expect(sent).toEqual([])
  })

  test('the entries leave the queue as they are handed over, and undo brings them back', async ($, on) => {
    const { type, aside, shown, idle } = world($, on)
    await type('+ a\n+? b')

    await aside('plan')
    await idle()
    expect(await shown()).toEqual(['The queue is empty.'])
    expect(await aside('undo')).toBe('Brought back 2 entries, 2 waiting.')
    expect(await shown()).toEqual(['1 idea and 1 comment waiting', '1 idea a', '2 question b'])
  })

  test('a planning prompt dropped beneath the plugin gives the entries back', async ($, on) => {
    const { w, sent, toasts, type, aside, shown, idle } = world($, on)
    await type('+ a')
    w.isDropping = true

    await aside('plan')
    await idle()
    expect(sent).toEqual([])
    expect(toasts).toEqual(['Could not hand the queue over (blocked by a hook); the entries are back in it'])
    expect(await shown()).toEqual(['1 idea waiting', '1 idea a'])
  })

  test('a hand-over the store refuses leaves the queue as it was and says why', async ($, on) => {
    const { w, sent, type, aside, shown, idle } = world($, on)
    await type('+ a\n+ b')
    w.isStoreFull = true

    expect(await aside('plan')).toBe('/aside plan did not finish (the store is full). /aside shows where the queue and the plan stand.')
    await idle()
    w.isStoreFull = false
    expect(sent).toEqual([])
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea b'])
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('a plan the store refuses is refused to Claude with the reason, and the items stay with the take', async ($, on) => {
    const { w, sent, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await type('+ a\n+ b')
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')
    w.isStoreFull = true

    expect((await savePlan([{ title: 'A', prompt: 'Do a.' }], [{ item: 2, question: 'What is b?' }])).deny).toBe(
      'aside could not save the plan (the store is full); the plan was not saved, so call the tool again',
    )
    w.isStoreFull = false
    const saved = await savePlan([{ title: 'A', prompt: 'Do a.' }], [{ item: 2, question: 'What is b?' }])
    expect(saved.result).toContain('Not in the plan, back in the queue')
    await endTurn('p1', 'aborted')
    expect(await aside('undo')).toBe('Brought back 1 entry, 2 waiting.')
  })

  test('a hand-over refused at its first write keeps what undo had, a clear included', async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ a')
    await aside('clear')
    await type('+ b')
    w.refuseWrite = 1

    expect(await aside('plan')).toBe('/aside plan did not finish (the store is full). /aside shows where the queue and the plan stand.')
    expect(await aside('undo')).toBe('Brought back 1 entry, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea b'])
  })

  test('a hand-over refused half-way leaves the queue as it was, with nothing for undo to bring back twice', async ($, on) => {
    const { w, sent, type, aside, shown, idle } = world($, on)
    await type('+ a\n+ b')
    // The take's two writes go through; the third, marking the tags handed over, is refused.
    w.refuseWrite = 3

    expect(await aside('plan')).toBe('/aside plan did not finish (the store is full). /aside shows where the queue and the plan stand.')
    await idle()
    expect(sent).toEqual([])
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea b'])
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('/aside run N refused half-way leaves the queue whole, with nothing for undo to bring back twice', async ($, on) => {
    const { w, sent, type, aside, shown, idle } = world($, on)
    await type('+ a\n+ b')
    // The take's two writes go through; the third, the queue without entry 1, is refused.
    w.refuseWrite = 3

    expect(await aside('run 1')).toBe('/aside run 1 did not finish (the store is full). /aside shows where the queue and the plan stand.')
    await idle()
    expect(sent).toEqual([])
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea b'])
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('a plan saved again after a refusal half-way gives each item left out back once', async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await type('+ a\n+ b')
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')
    // The item goes back to the queue; the next write, unmarking nothing, then the take, is refused.
    w.refuseWrite = 3
    const steps = [{ title: 'A', prompt: 'Do a.' }]
    const unclear = [{ item: 2, question: 'What is b?' }]

    expect((await savePlan(steps, unclear)).deny).toContain('the plan was not saved, so call the tool again')
    expect((await savePlan(steps, unclear)).result).toContain('Not in the plan, back in the queue')
    await endTurn('p1')
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea b'])
  })

  test('one of two entries typed alike, left out of the plan, goes back alone', async ($, on) => {
    const { sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await type('+ b\n+ b')
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')

    expect((await savePlan([{ title: 'B', prompt: 'Do b.' }], [{ item: 2, question: 'Which b?' }])).result).toContain('Not in the plan, back in the queue')
    await endTurn('p1')
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea b'])
  })

  test('a tag in a file is handed over once, and then shown as handed over', async ($, on) => {
    const { sent, write, aside, shown, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)

    expect(await aside('plan')).toBe('Organizing 1 comment.')
    await idle()
    expect(sent.at(-1)).toContain('[a <!-- --> tag in the file]: is this the same for Poland')
    expect(await aside('plan')).toBe('The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.')
    expect(await shown()).toEqual([
      'The queue is empty.',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions." · handed over',
    ])
  })

  test('undo brings back the tags a hand-over took, so the next plan takes them again', async ($, on) => {
    const { write, type, aside, shown, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)
    await type('+ a')
    await aside('plan')
    await idle()

    expect(await aside('undo')).toBe('Brought back 1 entry and 1 tag, 2 waiting.')
    expect(await shown()).toEqual([
      '1 idea waiting',
      '1 idea a',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions."',
    ])
    expect(await aside('plan')).toBe('Organizing 1 idea and 1 comment.')
  })

  test('with only tags handed over, undo brings the tags back', async ($, on) => {
    const { write, aside, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)
    await aside('plan')
    await idle()

    expect(await aside('undo')).toBe('Brought back 1 tag, 1 waiting.')
    expect(await aside('plan')).toBe('Organizing 1 comment.')
  })

  test('each take replaces what undo brings back: a clear after a plan brings back only what it cleared', async ($, on) => {
    const { write, type, aside, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)
    await type('+ a')
    await aside('plan')
    await idle()
    await type('+ b')
    await aside('clear')

    expect(await aside('undo')).toBe('Brought back 1 entry, 1 waiting.')
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('once Claude has saved a plan and answered, undo has nothing to bring back', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await type('+ a')
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')
    await savePlan([{ title: 'A', prompt: 'Do a.' }])
    await endTurn('p1')

    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('a planning turn that saved a plan but was interrupted leaves the hand-over for undo', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await type('+ a')
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')
    await savePlan([{ title: 'A', prompt: 'Do a.' }])
    await endTurn('p1', 'aborted')

    expect(await aside('undo')).toBe('Brought back 1 entry, 1 waiting.')
  })

  test('a planning turn that ends with no plan saved, answered or cut short, gives the queue back', async ($, on) => {
    const { sent, toasts, type, aside, shown, startTurn, endTurn, idle } = world($, on)
    await type('+ a\n+ b')

    for (const [turnId, reason] of [['p1', 'answer'], ['p2', 'aborted']] as const) {
      await aside('plan')
      await idle()
      await startTurn(sent.at(-1)!, turnId)
      await endTurn(turnId, reason)
      expect(toasts.at(-1)).toBe('No plan was saved: 2 entries back in the queue.')
      expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea b'])
    }
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('while a step runs, /aside run all is refused and sends nothing', async ($, on) => {
    const { sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ z', 's1')

    expect(await aside('run all')).toBe('Step 1 is running. /aside stop stops after it.')
    await idle()
    expect(sent).toHaveLength(1)
    await endTurn('s1', 'aborted')
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea z'])
  })

  test('once the entries a run sent as steps are done, undo has nothing to bring back', async ($, on) => {
    const { type, aside, answer, idle } = world($, on)
    await type('+ a\n+ b')
    await aside('run all')
    await idle()
    await answer('e1')
    await answer('e2')

    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('a clear stays undoable while the steps of a plan run', async ($, on) => {
    const { type, aside, savePlan, answer, idle } = world($, on)
    await savePlan(STEPS)
    await type('+ a')
    await aside('clear')
    await aside('run all')
    await idle()
    await answer('s1')
    await answer('s2')
    await answer('s3')

    expect(await aside('undo')).toBe('Brought back 1 entry, 1 waiting.')
  })

  test('a hand-over that failed leaves nothing for undo to bring back a second time', async ($, on) => {
    const { w, type, aside, shown, idle } = world($, on)
    await type('+ a')
    w.isDropping = true
    await aside('plan')
    await idle()

    expect(await aside('undo')).toBe('Nothing to bring back.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea a'])
  })

  test('a hand-over that failed gives undo back what it had before, such as a clear', async ($, on) => {
    const { w, type, aside, shown, idle } = world($, on)
    await type('+ old')
    await aside('clear')
    await type('+ a')
    w.isDropping = true
    expect(await aside('plan')).toBe('Organizing 1 idea.')
    await idle()

    expect(await shown()).toEqual(['1 idea waiting', '1 idea a'])
    expect(await aside('undo')).toBe('Brought back 1 entry, 2 waiting.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea old', '2 idea a'])
  })

  test('a clear made while a failing hand-over is on its way keeps what it cleared for undo', async ($, on) => {
    const { w, type, aside, shown, idle } = world($, on)
    await type('+ a')
    w.isDropping = true
    expect(await aside('plan')).toBe('Organizing 1 idea.')
    await type('+ b\n+ c')
    expect(await aside('clear')).toBe('Cleared 2 entries. /aside undo brings them back.')
    await idle()

    expect(await shown()).toEqual(['1 idea waiting', '1 idea a'])
    expect(await aside('undo')).toBe('Brought back 2 entries, 3 waiting.')
    expect(await shown()).toEqual(['3 ideas waiting', '1 idea b', '2 idea c', '3 idea a'])
  })

  test('with no plan, /aside run all runs each entry as a step of its own, one after another', async ($, on) => {
    const { sent, write, type, aside, shown, answer, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)
    await type('+ dark mode\n+! @docs/report.md:5 as a table')

    expect(await aside('run all')).toBe('Running 3 entries one by one. /aside stop stops after the current one.')
    expect(await shown()).toEqual([
      'Plan: 3 of 3 steps to do (/aside run)',
      '1 running dark mode',
      '2 to do as a table',
      '3 to do is this the same for Poland',
      'The queue is empty.',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions." · handed over',
    ])
    await idle()
    await answer('e1')
    await answer('e2')
    expect(sent).toEqual([
      [
        'dark mode (branch main)',
        '',
        '(Step 1 of 3 of the queue plan, "dark mode", sent by the aside plugin.',
        'Plan: 1 dark mode (this one) · 2 as a table (to do) · 3 is this the same for Poland (to do).',
        `${NEXT})`,
      ].join('\n'),
      [
        'Change - In docs/report.md: line 5:',
        'as a table (branch main)',
        '',
        '(Step 2 of 3 of the queue plan, "as a table", sent by the aside plugin.',
        'Plan: 1 dark mode (done) · 2 as a table (this one) · 3 is this the same for Poland (to do).',
        `${NEXT})`,
      ].join('\n'),
      [
        'Question - In docs/report.md: line 9, on "Costs stayed flat across all regions.":',
        'is this the same for Poland',
        '',
        'This comment is a <!-- --> tag in the file; remove the tag once it is handled.',
        '',
        '(Step 3 of 3 of the queue plan, "is this the same for Poland", sent by the aside plugin.',
        'Plan: 1 dark mode (done) · 2 as a table (done) · 3 is this the same for Poland (this one).',
        `${last('1 dark mode: no result kept', '2 as a table: no result kept')})`,
      ].join('\n'),
    ])
  })
})

describe('running the plan', () => {
  test('the model saves the plan, and /aside run sends each step when the one before ends', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, answer, idle } = world($, on)

    const saved = await savePlan(STEPS)
    expect(saved.result).toBe('Plan: 3 of 3 steps to do (/aside run)\n\n  1  to do  One\n  2  to do  Two\n  3  to do  Three')
    expect(saved.context).toEqual([
      'The user sees this plan drawn in a frame, so do not list its steps again. Say in a line or two why they come in this order, ' +
        'and ask your question about each item left out, if any. /aside run all runs the steps in order; /aside run runs the next one, /aside run N that one.',
    ])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 3 of 3 steps to do (/aside run)', '1 to do One', '2 to do Two', '3 to do Three'])

    expect(await aside('run all')).toBe('Running the plan: 3 steps, from step 1. /aside stop stops after the current one.')
    await idle()
    await answer('s1', 'Did one.\n\nResult: one is in place.', 40_000)
    await answer('s2', 'Did two.\n\n**Result:** two works, one question is open.', 20 * 60_000)
    await answer('s3', 'Result: three is done.\n\n## Summary of the run\n1 One: in place.', 3 * 60_000)
    expect(sent).toEqual([
      `Do one.\n\n(Step 1 of 3 of the queue plan, "One", sent by the aside plugin.\nPlan: 1 One (this one) · 2 Two (to do) · 3 Three (to do).\n${NEXT})`,
      `Do two.\n\n(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.\nPlan: 1 One (done) · 2 Two (this one) · 3 Three (to do).\n${NEXT})`,
      `Do three.\n\n(Step 3 of 3 of the queue plan, "Three", sent by the aside plugin.\nPlan: 1 One (done) · 2 Two (done) · 3 Three (this one).\n${last('1 One: one is in place.', '2 Two: two works, one question is open.')})`,
    ])
    expect(toasts).toEqual([
      'Step 1 done; step 2 runs now. Result: one is in place.',
      'Step 2 done; step 3 runs now. Result: two works, one question is open.',
      'Plan done: 3 steps in 24 min',
    ])
    expect(await shown()).toEqual([
      'The queue is empty.',
      'Plan done: 3 steps in 24 min',
      '1 done One',
      '↳ 40 s · one is in place.',
      '2 done Two',
      '↳ 20 min · two works, one question is open.',
      '3 done Three',
      '↳ 3 min · three is done.',
    ])
  })

  test('with every step done, /aside run N runs entry N alone, and the rest stay', async ($, on) => {
    const { sent, type, aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    await aside('run all')
    await idle()
    await answer('s1')
    await type('+ a\n+ b\n+ c')

    expect(await aside('run 3')).toBe('Running entry 3: c')
    await idle()
    expect(sent.at(-1)).toBe('c (branch main)\n\n(Step 1 of 1 of the queue plan, "c", sent by the aside plugin.)')
    expect(await shown()).toEqual(['Plan: 1 of 1 step to do (/aside run)', '1 running c', '2 ideas waiting', '1 idea a', '2 idea b'])
  })

  test('/aside run 3 1 runs those entries one after another, in that order', async ($, on) => {
    const { sent, type, aside, shown, answer, idle } = world($, on)
    await type('+ a\n+ b\n+ c')

    expect(await aside('run 3 1')).toBe('Running entries 3, 1 one by one. /aside stop stops after the current one.')
    await idle()
    await answer('e1')
    await answer('e2')
    expect(sent.map(text => text.split('\n')[0])).toEqual(['c (branch main)', 'a (branch main)'])
    expect(await shown()).toEqual(['1 idea waiting', '1 idea b', 'Plan done: 2 steps', '1 done c', '2 done a'])
  })

  test('while the plan has steps to do, /aside run 3 1 runs those steps in that order, then stops', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan(STEPS)

    expect(await aside('run 3 1')).toBe('Running steps 3, 1 one by one. /aside stop stops after the current one.')
    await idle()
    await answer('s3')
    await answer('s1')
    expect(sent).toEqual([
      `Do three.\n\n(Step 3 of 3 of the queue plan, "Three", sent by the aside plugin.\nPlan: 1 One (to do) · 2 Two (to do) · 3 Three (this one).\n${NEXT})`,
      `Do one.\n\n(Step 1 of 3 of the queue plan, "One", sent by the aside plugin.\nPlan: 1 One (this one) · 2 Two (to do) · 3 Three (done).\n${last('3 Three: no result kept')})`,
    ])
    expect(toasts).toEqual(['Step 3 done; step 1 runs now.', 'Step 1 done'])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 1 of 3 steps to do (/aside run)', '1 done One', '2 to do Two', '3 done Three'])
  })

  test('numbers out of range are refused, naming what they count', async ($, on) => {
    const { type, aside, savePlan } = world($, on)
    await type('+ a')

    expect(await aside('run 2')).toBe('Give an entry from 1 to 1, as /aside shows them.')
    expect(await aside('run 1 5')).toBe('Give entries from 1 to 1, as /aside shows them.')
    await savePlan(STEPS)
    expect(await aside('run 4')).toBe('Give a step from 1 to 3, as /aside shows them.')
  })

  test('a step run alone is told to do only that step', async ($, on) => {
    const { sent, aside, savePlan, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 2')
    await idle()

    expect(sent).toEqual([
      `Do two.\n\n(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.\nPlan: 1 One (to do) · 2 Two (this one) · 3 Three (to do).\n${ALONE})`,
    ])
  })

  test('a step takes the time by the clock from its start to its end, the time it waits for the person included', async ($, on) => {
    const { clock, sent, aside, shown, savePlan, wait, startTurn, endTurn, idle, pane } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await clock.advance(2 * 60_000)
    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /^Plan: / }))?.text).toBe('Plan: 3 of 3 steps to do (/aside run) · 2 min so far')
    expect((await ui.find({ type: 'Text', text: '↳ 2 min' }))?.text).toBe('↳ 2 min')
    await ui.unmount()

    await wait('needs your yes')
    await endTurn('s1', 'answer', 'Result: asked.', 30_000)
    await clock.advance(20 * 60_000)
    expect((await shown()).slice(1, 3)).toEqual(['1 waiting One', '↳ 22 min · asked.'])

    await aside('continue')
    await idle()
    expect((await shown()).slice(1, 4)).toEqual(['Plan: 2 of 3 steps to do (/aside run) · 22 min so far', '1 done One', '↳ 22 min · asked.'])
  })

  test('the turn that sums a run up keeps the time of its last step from that step\'s start', async ($, on) => {
    const { clock, sent, aside, shown, savePlan, wait, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan([STEPS[0], STEPS[1]])
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.', 60_000)
    await startTurn(sent.at(-1)!, 's2')
    await wait('which name')
    await endTurn('s2', 'answer', 'Result: asks.', 60_000)
    await clock.advance(30 * 60_000)

    expect(await aside('continue')).toBe('Step 2 ends here; Claude sums the run up.')
    await idle()
    await startTurn(sent.at(-1)!, 'c1')
    await clock.advance(60_000)
    await endTurn('c1', 'answer', 'Result: asks.\n\n## Summary of the run\n\nTwo asked.', 60_000)
    await idle()
    expect((await shown()).slice(1)).toEqual(['Plan done: 2 steps in 32 min', '1 done One', '↳ 1 min · one.', '2 done Two', '↳ 31 min · asks.'])
  })

  test('a step asked for while another turn runs starts its time with its own turn', async ($, on) => {
    const { clock, sent, aside, shown, savePlan, startTurn, endTurn, answer, idle, pane } = world($, on)
    await savePlan(STEPS)
    await startTurn('fix the other bug', 't0')
    await aside('run')
    await clock.advance(10 * 60_000)
    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /^Plan: / }))?.text).toBe('Plan: 3 of 3 steps to do (/aside run)')
    expect(await ui.find({ type: 'Text', text: /^↳ / })).toBeUndefined()
    await ui.unmount()

    await endTurn('t0')
    await idle()
    await answer('s1', 'Result: one.', 60_000)
    expect((await shown()).slice(2, 4)).toEqual(['1 done One', '↳ 1 min · one.'])
    expect(sent).toHaveLength(1)
  })

  test('a step of an earlier release, started with no time kept, shows the time its turns took', async ($, on) => {
    const stored = { 'plan:/proj': { steps: STEPS, active: { step: 0, isChain: true, sessionId: 'session-2', pausedFor: 'x', ms: 3 * 60_000, result: 'asked.' } } }
    const { clock, aside, shown } = world($, on, { stored })
    await clock.advance(60 * 60_000)

    expect((await shown()).slice(1, 3)).toEqual(['1 waiting One', '↳ 3 min · asked.'])
    await aside('continue')
    expect((await shown()).slice(1, 3)).toEqual(['1 done One', '↳ 3 min · asked.'])
  })

  test('a step that needs an answer waits for it with the wait tool: the answer is the step\'s own, and Claude\'s reply to it ends the step and goes on', async ($, on) => {
    const { sent, contexts, toasts, type, aside, shown, savePlan, wait, startTurn, endTurn, idle, band } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')

    expect((await wait('needs your yes on the design')).result).toBe(WAITS)
    await endTurn('s1', 'answer', 'A design.\n\nResult: the design is drawn up; it waits for a yes.', 60_000)
    await idle()
    expect(sent).toHaveLength(1)
    expect(toasts).toEqual([asks(1, 'needs your yes on the design')])
    expect(await shown()).toEqual([
      'Plan waits at step 1 (needs your yes on the design), 3 of 3 steps to do (/aside continue) · 1 min so far',
      '1 waiting One',
      '↳ 1 min · the design is drawn up; it waits for a yes.',
      '2 to do Two',
      '3 to do Three',
      'The queue is empty.',
    ])

    await type('yes, build it')
    expect(sent.at(-1)).toBe('yes, build it')
    expect(contexts.at(-1)).toEqual([answering(1, 'One')])
    await startTurn('yes, build it', 'a1')
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▱▱▱ 0/3 · step 1 running · ')
    expect((await ui.find({ key: 'action' }))?.props.label).toBe('stop')
    await ui.unmount()
    expect(await aside('continue')).toBe('Step 1 is running on your answer, and ends once Claude has answered. /aside stop stops after it.')
    await endTurn('a1', 'answer', 'Built.\n\nResult: built it; the tests pass.', 2 * 60_000)
    await idle()
    expect(sent).toHaveLength(3)
    expect(sent.at(-1)).toBe(`Do two.\n\n(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.\nPlan: 1 One (done) · 2 Two (this one) · 3 Three (to do).\n${NEXT})`)
    expect(contexts.at(-1)).toEqual([])
    expect((await shown()).slice(0, 3)).toEqual(['Plan: 2 of 3 steps to do (/aside run) · 3 min so far', '1 done One', '↳ 3 min · built it; the tests pass.'])
  })

  test('a step asked again after an answer waits for that answer, and every turn meanwhile is its own, a cut-short one too', async ($, on) => {
    const { sent, contexts, toasts, type, shown, savePlan, aside, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('which design')
    await endTurn('s1', 'answer', 'Result: two designs.', 60_000)
    // A turn that no message started, as a background task's notice does, is the step's, and
    // takes up no answer.
    await startTurn('', 'n0')
    await endTurn('n0')
    expect(toasts.at(-1)).toBe(asks(1, 'which design'))

    await type('the first')
    await startTurn('the first', 'a1')
    await wait('may I push')
    await endTurn('a1', 'answer', 'Result: built; may I push?', 60_000)
    expect(toasts.at(-1)).toBe(asks(1, 'may I push'))
    expect((await shown())[0]).toBe('Plan waits at step 1 (may I push), 3 of 3 steps to do (/aside continue) · 2 min so far')

    await type('yes')
    expect(contexts.at(-1)).toEqual([answering(1, 'One')])
    await startTurn('yes', 'a2')
    await endTurn('a2', 'aborted', 'Result: half done.', 60_000)
    expect(toasts.at(-1)).toBe("Step 1 waits: answer again, and Claude's reply ends it, or /aside continue ends it now.")
    expect((await shown()).slice(0, 3)).toEqual([
      'Plan waits at step 1 (answered), 3 of 3 steps to do (/aside continue) · 3 min so far',
      '1 waiting One',
      '↳ 3 min · built; may I push?',
    ])
    await startTurn('', 'n1')
    await endTurn('n1', 'answer', 'Result: pushed.', 60_000)
    await idle()
    expect(sent).toHaveLength(3)
    expect((await shown()).slice(0, 3)).toEqual([
      'Plan waits at step 1 (answered), 3 of 3 steps to do (/aside continue) · 4 min so far',
      '1 waiting One',
      '↳ 4 min · pushed.',
    ])
  })

  test('a step that waits ends at /aside continue whatever it waited for, and a message typed over a running turn reads nothing beside it', async ($, on) => {
    const { sent, contexts, type, aside, shown, savePlan, wait, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await type('meanwhile', 's1')
    expect(contexts.at(-1)).toEqual([])
    await endTurn('s1', 'answer', 'Result: asks x.')

    expect(await aside('continue')).toBe('Step 1 done; going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    await answer('s2', 'Result: two.')
    expect((await shown()).slice(0, 3)).toEqual(['Plan: 1 of 3 steps to do (/aside run)', '1 done One', '↳ asks x.'])
    await type('a plain message')
    expect(contexts.at(-1)).toEqual([])
  })

  test('the last step of a run that waits sums the run up in Claude\'s reply to the answer, which ends it', async ($, on) => {
    const { sent, contexts, toasts, type, aside, shown, savePlan, wait, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.', 60_000)
    await answer('s2', 'Result: two.', 60_000)
    await startTurn(sent.at(-1)!, 's3')

    expect((await wait('which name')).result).toBe(`${WAITS} Write no summary of the run yet: it comes once the step ends.`)
    await endTurn('s3', 'answer', 'Result: asks for a name.', 60_000)
    await idle()
    expect(toasts.at(-1)).toBe(asks(3, 'which name'))
    await type('call it x')
    expect(contexts.at(-1)).toEqual([answering(3, 'Three', ['1 One: one.', '2 Two: two.'])])
    await startTurn('call it x', 'a1')
    await endTurn('a1', 'answer', 'Named.\n\nResult: three is named x.\n\n## Summary of the run\n\nAll three done.', 60_000)
    await idle()

    expect(sent).toHaveLength(4)
    expect(toasts.at(-1)).toBe('Plan done: 3 steps in 4 min')
    expect((await shown()).slice(1)).toEqual([
      'Plan done: 3 steps in 4 min',
      '1 done One',
      '↳ 1 min · one.',
      '2 done Two',
      '↳ 1 min · two.',
      '3 done Three',
      '↳ 2 min · three is named x.',
    ])
  })

  test('a plan of one step that waits ends at /aside continue, with no turn to sum it up', async ($, on) => {
    const { sent, aside, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')

    expect((await wait('x')).result).toBe(WAITS)
    await endTurn('s1', 'answer', 'Result: asks x.', 60_000)
    expect(await aside('continue')).toBe('Plan done: 1 step in 1 min')
    await idle()
    expect(sent).toHaveLength(1)
  })

  test('a step run alone may wait too, and /aside continue then ends it with nothing to follow', async ($, on) => {
    const { sent, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 2')
    await idle()
    await startTurn(sent[0]!, 's2')
    await wait('x')
    await endTurn('s2', 'answer', 'Result: asks x.')

    expect(await aside('continue')).toBe('Step 2 done.')
    await idle()
    expect(sent).toHaveLength(1)
    expect((await shown())[1]).toBe('Plan: 2 of 3 steps to do (/aside run)')
  })

  test('a run of chosen steps that waits at one goes on with the steps it named once /aside continue ends it', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan([...STEPS, { title: 'Four', prompt: 'Do four.' }])
    await aside('run 3 1 2')
    await idle()
    await startTurn(sent[0]!, 's3')
    await $.tool.call({ tool: 'mcp__aside__wait', reason: 'which config to cache' } as never)
    await endTurn('s3')
    await idle()
    expect(sent).toHaveLength(1)

    expect(await aside('continue')).toBe('Step 3 done; going on with the plan from step 1: steps 1, 2. /aside stop stops after the current one.')
    await idle()
    await answer('s1')
    await answer('s2')
    expect(sent.map(text => text.split('\n')[0])).toEqual(['Do three.', 'Do one.', 'Do two.'])
    expect(toasts.at(-1)).toBe('Step 2 done')
    expect((await shown()).slice(1)).toEqual(['Plan: 1 of 4 steps to do (/aside run)', '1 done One', '2 done Two', '3 done Three', '4 to do Four'])
  })

  test('a run of chosen steps that waits at its second last step sends the last one, after /aside continue, as the end of the run', async ($, on) => {
    const { sent, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 3 1')
    await idle()
    await startTurn(sent[0]!, 's3')
    await $.tool.call({ tool: 'mcp__aside__wait', reason: 'x' } as never)
    await endTurn('s3', 'answer', 'Result: asks x.')

    expect(await aside('continue')).toBe('Step 3 done; going on with the plan from step 1: steps 1. /aside stop stops after the current one.')
    await idle()
    expect(sent.at(-1)).toBe(`Do one.\n\n(Step 1 of 3 of the queue plan, "One", sent by the aside plugin.\nPlan: 1 One (this one) · 2 Two (to do) · 3 Three (done).\n${last('3 Three: asks x.')})`)
  })

  test('/aside stop on a step that waits ends it as it stands, and the run stops there', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 3 1')
    await idle()
    await startTurn(sent[0]!, 's3')
    await $.tool.call({ tool: 'mcp__aside__wait', reason: 'x' } as never)
    await endTurn('s3', 'answer', 'Result: asks x.')

    expect(await aside('stop')).toBe('Step 3 is done as it stands, and the plan stops there.')
    await idle()
    expect(sent).toHaveLength(1)
    expect((await shown()).slice(1)).toEqual(['Plan: 2 of 3 steps to do (/aside run)', '1 to do One', '2 to do Two', '3 done Three', '↳ asks x.'])
    expect(await aside('stop')).toBe('Nothing is running.')
    expect(await aside('run all')).toBe('Running the plan: 2 steps, from step 1. /aside stop stops after the current one.')
  })

  test('/aside stop while Claude works on the answer ends the step with that turn, and nothing follows it', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1', 'answer', '', 60_000)
    await type('go')
    await startTurn('go', 'a1')

    expect(await aside('stop')).toBe('The plan stops after step 1.')
    await endTurn('a1', 'answer', 'Result: done with x.', 60_000)
    await idle()
    expect(sent).toHaveLength(2)
    expect(toasts.at(-1)).toBe('Step 1 done')
    expect((await shown()).slice(1, 4)).toEqual(['Plan: 2 of 3 steps to do (/aside run) · 2 min so far', '1 done One', '↳ 2 min · done with x.'])
  })

  test('/aside stop holds while Claude works on the answer: a turn cut short, or a new question, still ends the step as it stands', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1', 'answer', 'Result: drew the design.', 60_000)
    await type('go')
    await startTurn('go', 'a1')
    await aside('stop')

    await endTurn('a1', 'aborted', '', 60_000)
    await idle()
    expect(toasts.at(-1)).toBe('Step 1 done')
    expect((await shown()).slice(1, 4)).toEqual(['Plan: 2 of 3 steps to do (/aside run) · 2 min so far', '1 done One', '↳ 2 min · drew the design.'])

    await aside('run all')
    await idle()
    await startTurn(sent.at(-1)!, 's2')
    await wait('y')
    await endTurn('s2')
    await type('go on')
    await startTurn('go on', 'a2')
    await aside('stop')
    expect((await wait('may I push')).result).toBe(
      'The user has ended this step, so it ends with this reply and nothing waits for their answer. Ask your question all the same, then end your reply with the "Result: " line.',
    )
    await endTurn('a2', 'answer', 'Result: built; may I push?')
    await idle()
    expect(toasts.at(-1)).toBe('Step 2 done')
    expect((await shown())[1]).toBe('Plan: 1 of 3 steps to do (/aside run) · 2 min so far')
  })

  test('the turn that sums the run up keeps the last step done, cut short, stopped before it starts or dropped', async ($, on) => {
    const { w, sent, toasts, aside, shown, savePlan, wait, startTurn, endTurn, answer, idle } = world($, on)
    // A run of three whose last step asked, and waits for the answer.
    const answeredAtLast = async (id: string) => {
      await savePlan(STEPS)
      await aside('run all')
      await idle()
      await answer(`${id}1`)
      await answer(`${id}2`)
      await startTurn(sent.at(-1)!, `${id}3`)
      await wait('which name')
      await endTurn(`${id}3`, 'answer', 'Result: asks for a name.', 60_000)
      await idle()
    }

    await answeredAtLast('t')
    expect(await aside('continue')).toBe('Step 3 ends here; Claude sums the run up.')
    await idle()
    await startTurn(sent.at(-1)!, 'c1')
    await endTurn('c1', 'aborted', '', 60_000)
    await idle()
    expect(toasts.at(-1)).toBe('Plan done: 3 steps in 2 min')
    expect((await shown()).slice(-2)).toEqual(['3 done Three', '↳ 2 min · asks for a name.'])

    await answeredAtLast('u')
    await aside('continue')
    expect(await aside('stop')).toBe('Step 3 is done as it stands, and the plan stops there.')
    const before = sent.length
    await idle()
    expect(sent).toHaveLength(before)
    expect((await shown()).slice(-2)).toEqual(['3 done Three', '↳ 1 min · asks for a name.'])

    await answeredAtLast('v')
    w.isDropping = true
    await aside('continue')
    await idle()
    expect(toasts.at(-1)).toBe('Could not ask Claude to sum the run up (blocked by a hook); step 3 is done as it stands.')
    expect((await shown()).slice(-2)).toEqual(['3 done Three', '↳ 1 min · asks for a name.'])
  })

  test('an answer typed before the asking turn has ended is taken up by the turn it starts, which leaves the step waiting for continue', async ($, on) => {
    const { sent, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('which design')
    await type('the first', 's1')
    await endTurn('s1', 'answer', 'Result: two designs.', 60_000)
    // A background task's notice may come first.
    await startTurn('', 'n1')
    await endTurn('n1')

    // Typed over a turn, it went without the step's own words, so Claude was never told its
    // reply ends the step: the step waits on.
    await startTurn('the first', 'a1')
    await endTurn('a1', 'answer', 'Result: built the first.', 60_000)
    await idle()
    expect(sent).toEqual([expect.stringContaining('Step 1 of 3'), 'the first'])
    expect((await shown())[0]).toBe('Plan waits at step 1 (answered), 3 of 3 steps to do (/aside continue) · 2 min so far')
  })

  test('an answer again right after an answer turn cut short ends the step; one in which Claude asks again does not', async ($, on) => {
    const { sent, type, aside, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('which design')
    await endTurn('s1', 'answer', 'Result: two designs.')
    await type('the first')
    await startTurn('the first', 'a1')
    await endTurn('a1', 'aborted', '')

    await type('the first, please')
    await startTurn('the first, please', 'a2')
    await wait('which colour')
    expect(await aside('run 3')).toBe('Step 1 is running. /aside stop stops after it.')
    await endTurn('a2', 'answer', 'Result: asks for a colour.')
    await type('blue')
    await startTurn('blue', 'a3')
    await endTurn('a3', 'answer', 'Result: built it in blue.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
  })

  test('the answer typed again right after an answer turn cut short ends the step with Claude\'s reply', async ($, on) => {
    const { sent, type, aside, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('which design')
    await endTurn('s1', 'answer', 'Result: two designs.')
    await type('the first')
    await startTurn('the first', 'a1')
    await endTurn('a1', 'aborted', '')

    await type('the first, please')
    await startTurn('the first, please', 'a2')
    await endTurn('a2', 'answer', 'Result: built the first.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
  })

  test('the last step answered over its asking turn waits for continue, which has Claude sum the run up', async ($, on) => {
    const { sent, contexts, type, aside, savePlan, wait, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.')
    await answer('s2', 'Result: two.')
    await startTurn(sent.at(-1)!, 's3')
    await wait('which name')
    await type('call it x', 's3')
    expect(contexts.at(-1)).toEqual([])
    await endTurn('s3', 'answer', 'Result: asks for a name.')
    await startTurn('call it x', 'a1')
    await endTurn('a1', 'answer', 'Named it x.')
    await idle()
    expect(sent.at(-1)).toBe('call it x')

    expect(await aside('continue')).toBe('Step 3 ends here; Claude sums the run up.')
    await idle()
    expect(sent.at(-1)).toContain('I pressed continue, so this step ends here, and it was the last one of this run.')
  })

  test('after an answer turn cut short, the next answer ends the step, and a turn of something else meanwhile does not', async ($, on) => {
    const { sent, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('which design')
    await endTurn('s1', 'answer', 'Result: two designs.')
    await type('the first')
    await startTurn('the first', 'a1')
    await endTurn('a1', 'aborted', '')

    await startTurn('', 'n1')
    expect(await aside('run 3')).toBe('Step 1 is running. /aside stop stops after it.')
    await endTurn('n1', 'answer', 'Result: a notice.')
    expect((await shown())[0]).toMatch(/^Plan waits at step 1 \(answered\)/)

    await type('the first, again')
    await startTurn('the first, again', 'a2')
    expect(await aside('run 3')).toBe('Step 1 is running on your answer, and ends once Claude has answered. /aside stop stops after it.')
    await endTurn('a2', 'answer', 'Result: built the first.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
  })

  test('a slash command typed while a step waits reads nothing beside it, and an answer through Remote Control is the step\'s own', async ($, on) => {
    const { sent, contexts, aside, savePlan, wait, startTurn, endTurn, fromPhone, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1', 'answer', 'Result: asks x.')

    await $.prompt.submit({ text: '/compact', origin: { kind: 'composer' }, wait: false, command: { name: 'compact', args: '' } } as never)
    expect(contexts.at(-1)).toEqual([])
    await fromPhone('yes')
    await idle()
    expect(sent.at(-1)).toBe('yes')
    expect(contexts.at(-1)).toEqual([answering(1, 'One')])
  })

  test('while a step waits, /aside run N and undo wait for it, and say how to end it', async ($, on) => {
    const { sent, type, aside, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1')
    await type('+ a')

    const why = 'Step 1 waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.'
    expect(await aside('run 3')).toBe(why)
    expect(await aside('undo')).toBe('Step 1 of the plan waits for your answer; /aside stop first, so nothing is done twice.')
    await idle()
    expect(sent).toHaveLength(1)

    // An answer turn cut short leaves the step waiting for continue.
    await type('yes')
    await startTurn('yes', 'a1')
    await endTurn('a1', 'aborted', 'Result: done.')
    expect(await aside('run 3')).toBe("Step 1 waits: answer again, and Claude's reply ends it, or /aside continue ends it and goes on; /aside stop ends it there.")
    expect(await aside('undo')).toBe('Step 1 of the plan waits for your answer again or /aside continue; /aside stop first, so nothing is done twice.')
  })

  test('in the turn that called the wait tool, /aside continue and /aside plan take the step as running, not as running on an answer', async ($, on) => {
    const { sent, type, aside, savePlan, wait, startTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')

    expect(await aside('continue')).toBe('Step 1 is running. /aside stop stops after it.')
    await type('+ dark mode', 's1')
    expect(await aside('plan')).toBe("Step 1 is running; once it ends, Claude organizes the queue into steps after the plan's own, and /aside continue goes on.")
  })

  test('a step that waits in another session, or in this one before /clear, takes no turn here, and /aside continue here ends it and goes on', async ($, on) => {
    const { sent, contexts, type, aside, shown, startTurn, endTurn, idle, fromAnotherSession } = world($, on)
    await fromAnotherSession('plan:/proj', { steps: STEPS, active: { step: 0, isChain: true, sessionId: 'session-2', pausedFor: 'x', ms: 60_000 } })
    await type('hello')
    expect(contexts.at(-1)).toEqual([])
    await startTurn('hello', 't1')
    await endTurn('t1', 'answer', 'Result: hi.', 60_000)
    await idle()
    expect((await shown())[0]).toBe('Plan waits at step 1 (x), 3 of 3 steps to do (/aside continue) · 1 min so far')

    expect(await aside('run 3')).toBe('Step 1 waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.')
    expect(await aside('undo')).toBe('Step 1 of the plan waits for your answer; /aside stop first, so nothing is done twice.')
    expect(await aside('continue')).toBe(
      'Step 1 done; going on with the plan from step 2. /aside stop stops after the current one. (another session had step 1 waiting for an answer; this one takes over)',
    )
    await idle()
    expect(sent.at(-1)).toContain('Do two.')
    expect((await shown()).slice(0, 2)).toEqual(['Plan: 2 of 3 steps to do (/aside run) · 1 min so far', '1 done One'])
  })

  test('the last step of a run that waits in another session sums the run up here at /aside continue', async ($, on) => {
    const { sent, toasts, aside, answer, idle, fromAnotherSession } = world($, on)
    const steps = [{ ...STEPS[0], isDone: true, ms: 0, result: 'one.' }, { ...STEPS[1], isDone: true, ms: 0, result: 'two.' }, STEPS[2]]
    await fromAnotherSession('plan:/proj', { steps, active: { step: 2, isChain: true, sessionId: 'session-2', pausedFor: 'x', ms: 60_000 } })

    expect(await aside('continue')).toBe('Step 3 ends here; Claude sums the run up. (another session had step 3 waiting for an answer; this one takes over)')
    await idle()
    expect(sent.at(-1)).toContain('I pressed continue, so this step ends here')
    await answer('c1', 'Result: three.', 60_000)
    expect(toasts.at(-1)).toBe('Plan done: 3 steps in 2 min')
  })

  test('/aside stop ends a step that waits in another session as it stands', async ($, on) => {
    const { aside, shown, fromAnotherSession } = world($, on)
    await fromAnotherSession('plan:/proj', { steps: STEPS, active: { step: 0, isChain: true, sessionId: 'session-2', pausedFor: 'x' } })

    expect(await aside('stop')).toBe('Step 1 is done as it stands, and the plan stops there.')
    expect((await shown())[1]).toBe('Plan: 2 of 3 steps to do (/aside run)')
  })

  test('/aside stop lets go of a step that runs on an answer in another session, and it stays to do', async ($, on) => {
    const { aside, shown, fromAnotherSession } = world($, on)
    await fromAnotherSession('plan:/proj', { steps: STEPS, active: { step: 0, isChain: true, sessionId: 'session-2', pausedFor: 'x', turnId: 'a1', ms: 0 } })

    expect(await aside('stop')).toBe('The plan stopped at step 1.')
    expect((await shown())[1]).toBe('Plan: 3 of 3 steps to do (/aside run)')
  })

  test('/aside continue and a turn that starts as it ends the step never both win: the step ends, and the turn is no answer to it', async ($, on) => {
    const { w, sent, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1', 'answer', 'Result: asks x.')
    w.beforeWrite = async () => {
      w.beforeWrite = undefined
      void startTurn('hello', 't1')
    }

    expect(await aside('continue')).toBe('Step 1 done; going on with the plan from step 2. /aside stop stops after the current one.')
    await endTurn('t1', 'answer', 'Result: hi.', 60_000)
    await idle()
    expect(sent.at(-1)).toContain('Do two.')
    expect((await shown()).slice(0, 4)).toEqual(['Plan: 2 of 3 steps to do (/aside run)', '1 done One', '↳ asks x.', '2 running Two'])
  })

  test('a plan saved by an earlier release, paused after a step by the wait tool, still loads, and a step run by its number drops the pause', async ($, on) => {
    const stored = { 'plan:/proj': { steps: [{ ...STEPS[0], isDone: true, ms: 0 }, STEPS[1], STEPS[2]], paused: { step: 0, reason: 'needs your yes', isChain: true } } }
    const { sent, aside, shown, answer, idle } = world($, on, { stored })
    expect((await shown())[0]).toBe('Plan paused after step 1 (needs your yes), 2 of 3 steps to do (/aside continue)')

    expect(await aside('run 3')).toBe('Running step 3: Three')
    await idle()
    await answer('s3')
    expect(sent).toHaveLength(1)
    expect((await shown())[1]).toBe('Plan: 1 of 3 steps to do (/aside run)')
    expect(await aside('stop')).toBe('Nothing is running.')
  })

  test('/aside stop drops a paused run, and /aside run then starts again from the first step to do', async ($, on) => {
    const stored = { 'plan:/proj': { steps: [{ ...STEPS[0], isDone: true, ms: 0 }, STEPS[1], STEPS[2]], paused: { step: 0, reason: 'needs your yes', isChain: true } } }
    const { aside, shown } = world($, on, { stored })

    expect(await aside('stop')).toBe('Dropped the paused run. /aside run all starts the plan again from its first step to do.')
    expect((await shown())[1]).toBe('Plan: 2 of 3 steps to do (/aside run)')
    expect(await aside('run all')).toBe('Running the plan: 2 steps, from step 2. /aside stop stops after the current one.')
  })

  test('when the store refuses the pause, the wait tool tells Claude to call it again', async ($, on) => {
    const { w, sent, aside, savePlan, startTurn, wait, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    w.isStoreFull = true

    expect((await wait('x')).deny).toBe('aside could not pause the plan (the store is full); call the tool again')
  })

  test('when the store fails at the start or the end of a step, aside says so in a toast', async ($, on) => {
    const { w, sent, toasts, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    w.isStoreFull = true

    await startTurn(sent[0]!, 's1')
    expect(toasts.at(-1)).toBe('Could not note the start of this turn (the store is full); a running plan may not go on by itself')
    w.isStoreFull = false
    await startTurn(sent[0]!, 's1')
    w.isStoreFull = true
    await endTurn('s1')
    expect(toasts.at(-1)).toBe(
      'Could not finish its work at the end of this turn (the store is full); /aside shows where the queue and the plan stand',
    )
  })

  test('a dropped hand-over the store will not take back is told once, with both reasons', async ($, on) => {
    const { w, toasts, type, aside, idle } = world($, on)
    await type('+ a')
    w.isDropping = true
    await aside('plan')
    w.isStoreFull = true
    await idle()

    expect(toasts).toEqual(['Could not send its prompt (blocked by a hook), nor set things back: the store is full'])
  })

  test('the wait tool is refused outside a step of the plan', async ($, on) => {
    world($, on)

    expect((await $.tool.call({ tool: 'mcp__aside__wait', reason: 'x' } as never)).deny).toBe(
      'no step of the aside plan is running; call this tool only from a step of the plan',
    )
  })

  test('/aside stop while a step runs makes it the last', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await answer('s1')

    await startTurn(sent.at(-1)!, 's2')
    expect(await aside('stop')).toBe('The plan stops after step 2.')
    await endTurn('s2')
    await idle()
    expect(sent).toHaveLength(2)
    expect(toasts).toEqual(['Step 1 done; step 2 runs now.', 'Step 2 done'])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 1 of 3 steps to do (/aside run)', '1 done One', '2 done Two', '3 to do Three'])
  })

  test('/aside stop between two steps keeps the next one from going out', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')

    await endTurn('s1')
    expect(await aside('stop')).toBe('The plan stopped before step 2.')
    await idle()
    expect(sent).toHaveLength(1)
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 2 of 3 steps to do (/aside run)', '1 done One', '2 to do Two', '3 to do Three'])
  })

  test('a plan is refused when it has no steps, or while a step of the current one runs', async ($, on) => {
    const { sent, aside, savePlan, startTurn, idle } = world($, on)

    expect((await savePlan([])).deny).toBe('steps must be a non-empty list of { title, prompt }, each prompt non-empty')
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    expect((await savePlan(STEPS)).deny).toBe('step 1 of the current plan is running; the user stops it with /aside stop first')
  })

  test('/aside run N runs step N alone, and an interrupted step stops the plan', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)

    expect(await aside('run 3')).toBe('Running step 3: Three')
    await idle()
    await startTurn(sent[0]!, 's3')
    expect(await aside('run all')).toBe('Step 3 is running. /aside stop stops after it.')
    await endTurn('s3', 'aborted')
    expect(toasts).toEqual(['Plan stopped: step 3 was interrupted'])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 3 of 3 steps to do (/aside run)', '1 to do One', '2 to do Two', '3 to do Three'])
  })

  test('a step prompt dropped beneath the plugin lets the plan go', async ($, on) => {
    const { w, toasts, aside, savePlan, idle } = world($, on)
    await savePlan(STEPS)
    w.isDropping = true

    await aside('run all')
    await idle()
    expect(toasts).toEqual(['Could not send step 1 of the plan: blocked by a hook'])
    expect(await aside('stop')).toBe('Nothing is running.')
  })

  test('/aside run all runs the saved plan first, then the queue entry by entry', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    await type('+ extra')

    expect(await aside('run all')).toBe('Running the plan: 1 step, from step 1. /aside stop stops after the current one.')
    await idle()
    await startTurn(sent[0]!, 'x1')
    await endTurn('x1')

    expect(await aside('run all')).toBe('Running 1 entry one by one. /aside stop stops after the current one.')
    await idle()
    expect(sent.at(-1)).toBe('extra (branch main)\n\n(Step 1 of 1 of the queue plan, "extra", sent by the aside plugin.)')
  })

  test('with a plan, /aside run runs its next step alone, and the queue waits until the plan is done', async ($, on) => {
    const { sent, type, aside, savePlan, answer, shown, idle } = world($, on)
    await savePlan(STEPS)
    await type('+ extra')

    expect(await aside('run')).toBe('Running step 1: One')
    await idle()
    expect(sent[0]).toContain(ALONE)
    await answer('s1')
    expect(sent).toHaveLength(1)
    expect(await aside('run')).toBe('Running step 2: Two')
    await idle()
    await answer('s2')
    expect(await aside('run')).toBe('Running step 3: Three')
    await idle()
    await answer('s3')
    expect(sent).toHaveLength(3)
    expect((await shown())[0]).toBe('1 idea waiting')

    expect(await aside('run')).toBe('Running entry 1: extra')
  })

  test('in a paused run, /aside run runs the step after the pause alone, and /aside continue goes on with the rest', async ($, on) => {
    const steps = [{ ...STEPS[0], isDone: true, ms: 0 }, STEPS[1], STEPS[2]]
    const stored = { 'plan:/proj': { steps, paused: { step: 0, reason: 'needs your yes', isChain: true } } }
    const { sent, aside, answer, idle } = world($, on, { stored })

    expect(await aside('run')).toBe('Running step 2: Two; /aside continue then goes on with the paused run.')
    await idle()
    await answer('s2')
    expect(sent).toHaveLength(1)

    expect(await aside('continue')).toBe('Going on with the plan from step 3. /aside stop stops after the current one.')
    await idle()
    expect(sent).toHaveLength(2)
  })

  test('in a paused run, /aside continue goes on with the rest of it', async ($, on) => {
    const steps = [{ ...STEPS[0], isDone: true, ms: 0 }, STEPS[1], STEPS[2]]
    const stored = { 'plan:/proj': { steps, paused: { step: 0, reason: 'needs your yes', isChain: true } } }
    const { sent, aside, answer, idle } = world($, on, { stored })

    expect(await aside('continue')).toBe('Going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    await answer('s2')
    expect(sent).toHaveLength(2)
  })

  test('in a paused run of chosen steps, /aside run runs the next of them, and the rest stays paused for /aside continue', async ($, on) => {
    const steps = [{ ...STEPS[0], isDone: true, ms: 0 }, STEPS[1], STEPS[2], { title: 'Four', prompt: 'Do four.' }]
    const stored = { 'plan:/proj': { steps, paused: { step: 0, reason: 'needs your yes', isChain: false, then: [3, 2] } } }
    const { sent, aside, answer, shown, idle } = world($, on, { stored })

    expect(await aside('run')).toBe('Running step 4: Four; /aside continue then goes on with the paused run.')
    await idle()
    expect(sent[0]).toContain(ALONE)
    await answer('s4')
    expect((await shown())[0]).toBe('Plan paused after step 4 (needs your yes), 2 of 4 steps to do (/aside continue)')

    expect(await aside('run')).toBe('Running step 3: Three; /aside continue then goes on with the paused run.')
    await idle()
    await answer('s3')
    expect(await aside('continue')).toBe('Running the plan: 1 step, from step 2. /aside stop stops after the current one.')
  })

  test('while a step waits, /aside run ends it and goes on with its run, as /aside continue does', async ($, on) => {
    const { sent, aside, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1')

    expect(await aside('run')).toBe('Step 1 done; going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    expect(sent).toHaveLength(2)
  })

  test('while a step runs here, /aside run starts nothing', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, idle } = world($, on)
    await savePlan(STEPS)
    await type('+ extra')
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')

    expect(await aside('run')).toBe('Step 1 is running. /aside stop stops after it.')
    await idle()
    expect(sent).toHaveLength(1)
  })

  test('a plan another session starts while /aside run takes an entry stays, the entry goes back to the queue, and undo keeps what it had', async ($, on) => {
    const { w, sent, type, aside, shown, idle, fromAnotherSession } = world($, on)
    await type('+ old')
    await aside('clear')
    await type('+ a\n+ b')
    w.beforeWrite = async key => {
      if (!key.startsWith('queue:')) return
      w.beforeWrite = undefined
      await fromAnotherSession('plan:/proj', { steps: STEPS, active: { step: 0, isChain: true, sessionId: 'session-2', turnId: 'other' } })
    }

    expect(await aside('run')).toBe('Another session started a plan meanwhile; the entries stay in the queue, and /aside shows the plan.')
    await idle()
    expect(sent).toEqual([])
    expect(await shown()).toEqual(['Plan: 3 of 3 steps to do (/aside run)', '1 running One', '2 to do Two', '3 to do Three', '2 ideas waiting', '1 idea a', '2 idea b'])
    expect(await aside('undo')).toBe('Brought back 1 entry, 3 waiting.')
    expect((await shown()).slice(4, 8)).toEqual(['3 ideas waiting', '1 idea old', '2 idea a', '3 idea b'])
  })

  test('/aside undo waits while a step runs, so nothing is done twice', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, idle } = world($, on)
    await type('+ a')
    await aside('plan')
    await idle()
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent.at(-1)!, 's1')

    expect(await aside('undo')).toBe('Step 1 of the plan is running; /aside stop first, so nothing is done twice.')
  })

  test('an entry removed as run all gives the queue back to a plan another session started stays removed', async ($, on) => {
    const { w, clock, type, aside, shown, fromAnotherSession } = world($, on)
    await type('+ dark mode')
    // Another session saves a plan as this one takes the queue, and the person removes the entry
    // while it is on its way back.
    let removing: Promise<string> | undefined
    w.beforeWrite = async key => {
      if (!key.startsWith('taken')) return
      await fromAnotherSession('plan:/proj', { steps: STEPS })
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        removing = aside('remove 1')
        await clock.sleep(2)
      }
    }
    const running = aside('run all')
    await clock.settle()
    await clock.advance(5)

    expect(await running).toBe('Another session started a plan meanwhile; the entries stay in the queue, and /aside shows the plan.')
    expect(await removing).toBe('Removed: dark mode')
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 3 of 3 steps to do (/aside run)', '1 to do One', '2 to do Two', '3 to do Three'])
  })

  test('of two entries typed alike, one run as a plan another session started gives it back stays, and the other removed meanwhile stays removed', async ($, on) => {
    const { w, clock, type, aside, shown, fromAnotherSession } = world($, on)
    await type('+ dark mode\n+ dark mode')
    // Another session saves a plan as this one takes entry 1, and the person removes the other
    // as the queue is stored without it.
    let removing: Promise<string> | undefined
    w.beforeWrite = async key => {
      if (!key.startsWith('taken')) return
      await fromAnotherSession('plan:/proj', { steps: STEPS })
      w.beforeWrite = async key => {
        if (!key.startsWith('queue:')) return
        w.beforeWrite = undefined
        removing = aside('remove 1')
        await clock.sleep(2)
      }
    }
    const running = aside('run 1')
    await clock.settle()
    await clock.advance(5)

    expect(await running).toBe('Another session started a plan meanwhile; the entries stay in the queue, and /aside shows the plan.')
    expect(await removing).toBe('Removed: dark mode')
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea dark mode'])
  })
})

describe('when Claude answers', () => {
  test('the default waits for /aside', async ($, on) => {
    const { sent, type, startTurn, endTurn, idle } = world($, on)
    await startTurn('build', 't1')
    await type('+ dark mode', 't1')
    await endTurn('t1')
    await idle()

    expect(sent).toEqual([])
  })

  test('afterClaudeAnswers plan hands the queue over by itself, but not after its own turn', { options: { afterClaudeAnswers: 'plan' } }, async ($, on) => {
    const { sent, toasts, type, startTurn, endTurn, idle } = world($, on)
    await startTurn('build the parser', 't1')
    await type('+ dark mode', 't1')
    await endTurn('t1')
    await idle()
    expect(toasts).toEqual(['Organizing 1 idea.'])
    expect(sent.at(-1)).toContain('Organize all of it')

    await startTurn(sent.at(-1)!, 'p1')
    await type('+ another', 'p1')
    await endTurn('p1')
    await idle()
    expect(sent).toHaveLength(1)
  })

  test('afterClaudeAnswers run all runs each entry as a step of its own', { options: { afterClaudeAnswers: 'run all' } }, async ($, on) => {
    const { sent, toasts, type, startTurn, endTurn, idle } = world($, on)
    await startTurn('build', 't1')
    await type('+ dark mode\n+ tests', 't1')
    await endTurn('t1')
    await idle()

    expect(toasts).toEqual(['Running 2 entries one by one. /aside stop stops after the current one.'])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('(Step 1 of 2 of the queue plan, "dark mode", sent by the aside plugin.')
  })

  test('afterClaudeAnswers run all leaves a plan another session starts meanwhile, and the entries stay in the queue', { options: { afterClaudeAnswers: 'run all' } }, async ($, on) => {
    const { w, sent, toasts, type, shown, startTurn, endTurn, idle, fromAnotherSession } = world($, on)
    await startTurn('build', 't1')
    await type('+ dark mode', 't1')
    w.beforeWrite = async key => {
      if (!key.startsWith('taken')) return
      w.beforeWrite = undefined
      await fromAnotherSession('plan:/proj', { steps: STEPS, active: { step: 0, isChain: true, sessionId: 'session-2', turnId: 'other' } })
    }
    await endTurn('t1')
    await idle()

    expect(toasts).toEqual(['Another session started a plan meanwhile; the entries stay in the queue, and /aside shows the plan.'])
    expect(sent).toEqual([])
    expect(await shown()).toEqual(['Plan: 3 of 3 steps to do (/aside run)', '1 running One', '2 to do Two', '3 to do Three', '1 idea waiting', '1 idea dark mode'])
  })

  test('a saved plan with steps to do holds the automatic hand-over back', { options: { afterClaudeAnswers: 'plan' } }, async ($, on) => {
    const { sent, toasts, logged, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    await startTurn('build', 't1')
    await type('+ c', 't1')
    const said = logged.length
    await endTurn('t1')
    await idle()
    expect(sent).toEqual([])
    expect(toasts).toEqual([])
    expect(logged.slice(said)).toEqual([])

    await aside('plan')
    await idle()
    expect(sent[0]).toContain('The saved plan still has these steps to do.')
    expect(sent[0]).toContain('\nS1. One\n   Do one.')
  })
})

describe('organizing the queue again', () => {
  const LONG = ['Rework the planning flow.', '- keep every line of this step', '- and every word, however long it runs: ' + 'more detail, '.repeat(30) + 'the end.'].join('\n')

  test('a replan gets the steps still to do whole, numbered apart from the items, and keeps the steps done first', async ($, on) => {
    const { sent, type, aside, shown, savePlan, answer, startTurn, endTurn, idle } = world($, on)
    await savePlan([
      { title: 'One', prompt: 'Do one.' },
      { title: 'Two', prompt: LONG },
    ])
    await aside('run 1')
    await idle()
    await answer('s1')
    await type('+ a new task')

    await aside('plan')
    await idle()
    expect(sent.at(-1)).toContain(`Ideas:\n1. a new task (branch main)`)
    expect(sent.at(-1)).toContain(`\nS1. Two\n   ${LONG.replace(/\n/g, '\n   ')}\n\n`)
    expect(sent.at(-1)).toContain('The steps already done stay at the top of the plan by themselves, so save only the steps to do.')
    await startTurn(sent.at(-1)!, 'p1')
    await savePlan([
      { title: 'Two', prompt: LONG },
      { title: 'New', prompt: 'Do the new task.' },
    ])
    await endTurn('p1')
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 2 of 3 steps to do (/aside run)', '1 done One', '2 to do Two', '3 to do New'])
  })

  test('a plan saved once every step is done replaces it whole', async ($, on) => {
    const { aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    await aside('run all')
    await idle()
    await answer('s1')

    await savePlan([{ title: 'Fresh', prompt: 'Do it.' }])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 1 of 1 step to do (/aside run)', '1 to do Fresh'])
  })

  test('the items Claude leaves out of the plan go back to the queue, each shown with its question', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await type('+ a\n+ b\n+ c')
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')

    const wrong = await savePlan([{ title: 'A and C', prompt: 'Do a and c.' }], [{ item: 4, question: 'What is it?' }])
    expect(wrong.deny).toBe('unclear must list items by their number in the queue, from 1 to 3, each with a question')
    const saved = await savePlan([{ title: 'A and C', prompt: 'Do a and c.' }], [{ item: 2, question: 'What is b for?' }])
    expect(saved.result).toBe(
      [
        'Plan: 1 of 1 step to do (/aside run)',
        '',
        '  1  to do  A and C',
        '',
        'Not in the plan, back in the queue',
        '',
        '  ·  idea  b',
        '           ↳ What is b for?',
      ].join('\n'),
    )
    await endTurn('p1', 'aborted')
    expect(toasts).toEqual([])
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea b'])
    // What undo brings back is only what the plan took: b is in the queue once.
    expect(await aside('undo')).toBe('Brought back 2 entries, 3 waiting.')
    expect((await shown()).slice(0, 4)).toEqual(['3 ideas waiting', '1 idea a', '2 idea c', '3 idea b'])
  })

  test('a plan saved outside the turn that organizes the queue leaves nothing out', async ($, on) => {
    const { shown, savePlan } = world($, on)

    const saved = await savePlan([{ title: 'One', prompt: 'Do one.' }], [{ item: 1, question: 'What?' }])
    expect(saved.result).toBe('Plan: 1 of 1 step to do (/aside run)\n\n  1  to do  One')
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 1 of 1 step to do (/aside run)', '1 to do One'])
  })
})

describe('adding to a running plan', () => {
  // What Claude reads of the plan it adds to, after the queue.
  const adding = (...steps: string[]) =>
    [
      'The saved plan is under way, so its steps stay as they are, done or not. Plan only the items above, as new steps: save only those, and they are added after the last of these steps, none of which you repeat.',
      ...steps,
    ].join('\n')
  const LATER = "Step 1 is running; once it ends, Claude organizes the queue into steps after the plan's own, and /aside continue goes on."

  test('/aside plan while a step runs waits for its end, then has Claude add steps after the plan\'s own, and continue runs them in turn', async ($, on) => {
    const { sent, toasts, logged, type, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')

    expect(await aside('plan')).toBe(LATER)
    expect(logged.at(-1)).toBe(LATER)
    await idle()
    expect(sent).toHaveLength(1)
    await endTurn('s1')
    await idle()
    expect(toasts).toEqual(['Plan paused after step 1: to organize the queue. /aside continue goes on.'])
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('Ideas:\n1. dark mode (branch main)')
    expect(sent[1]).toContain(`\n\n${adding('S1. One (done)', 'S2. Two (to do)', 'S3. Three (to do)')}\n\n`)
    expect(sent[1]).not.toContain('S1. Two')

    await startTurn(sent[1]!, 'p1')
    await savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await endTurn('p1')
    expect(await shown()).toEqual([
      'Plan paused after step 1 (to organize the queue), 3 of 4 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
      '4 to do Dark mode',
      'The queue is empty.',
    ])
    expect(await aside('continue')).toBe('Going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    await answer('s2')
    await answer('s3')
    expect(sent.at(-1)).toContain('Add a dark mode.\n\n(Step 4 of 4 of the queue plan, "Dark mode"')
    await answer('s4')
    expect(toasts.at(-1)).toBe('Plan done: 4 steps')
  })

  test('a step that waits for an answer keeps waiting while the queue /aside plan asked for is organized once its turn ends', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await wait('which colours')

    await endTurn('s1')
    await idle()
    expect(toasts).toEqual([asks(1, 'which colours')])
    expect(sent[1]).toContain(adding('S1. One (waits for my answer)', 'S2. Two (to do)', 'S3. Three (to do)'))
    await startTurn(sent[1]!, 'p1')
    expect((await wait('x')).deny).toBe('no step of the aside plan is running; call this tool only from a step of the plan')
    await savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await endTurn('p1')
    expect((await shown()).slice(0, -1)).toEqual([
      'Plan waits at step 1 (which colours), 4 of 4 steps to do (/aside continue)',
      '1 waiting One',
      '2 to do Two',
      '3 to do Three',
      '4 to do Dark mode',
    ])

    // Asked once, it is organized once: the answer turn's end organizes nothing more.
    await type('+ light mode')
    await type('blue')
    await startTurn('blue', 'a1')
    await endTurn('a1', 'answer', 'Result: blue it is.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 4 of the queue plan, "Two", sent by the aside plugin.')
  })

  test('an answer turn cut short organizes nothing that /aside plan asked for, and says /aside plan does', async ($, on) => {
    const { sent, toasts, type, aside, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1')
    await type('go')
    await startTurn('go', 'a1')
    await type('+ dark mode', 'a1')
    await aside('plan')

    await endTurn('a1', 'aborted')
    await idle()
    expect(sent.at(-1)).toBe('go')
    expect(toasts.at(-1)).toBe("Step 1 waits: answer again, and Claude's reply ends it, or /aside continue ends it now; /aside plan organizes the queue.")
  })

  test('/aside plan while a step waits organizes the queue at once, after the plan\'s own steps, and while Claude works on the answer, once it has answered', async ($, on) => {
    const { sent, contexts, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('which colours')
    await endTurn('s1')
    await type('+ dark mode')

    expect(await aside('plan')).toBe('Organizing 1 idea.')
    await idle()
    expect(sent.at(-1)).toContain(adding('S1. One (waits for my answer)', 'S2. Two (to do)', 'S3. Three (to do)'))
    await startTurn(sent.at(-1)!, 'p1')
    // Typed while Claude organizes, it may go into that turn, so it reads nothing beside it.
    await type('meanwhile', 'p1')
    expect(contexts.at(-1)).toEqual([])
    await savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await endTurn('p1')
    expect((await shown())[0]).toBe('Plan waits at step 1 (which colours), 4 of 4 steps to do (/aside continue)')

    await type('blue')
    await startTurn('blue', 'a1')
    await type('+ light mode', 'a1')
    expect(await aside('plan')).toBe("Step 1 is running on your answer; once Claude has answered, it organizes the queue into steps after the plan's own, and /aside continue goes on.")
    await idle()
    expect(sent.at(-1)).toBe('blue')
    await endTurn('a1', 'answer', 'Result: blue it is.')
    await idle()
    // The answer ends the step, and the run waits for the queue to be organized.
    expect(sent.at(-1)).toContain(adding('S1. One (done)', 'S2. Two (to do)', 'S3. Three (to do)', 'S4. Dark mode (to do)'))
    await startTurn(sent.at(-1)!, 'p2')
    await savePlan([{ title: 'Light mode', prompt: 'Add a light mode.' }])
    await endTurn('p2')
    expect((await shown()).slice(0, -1)).toEqual([
      'Plan paused after step 1 (to organize the queue), 4 of 5 steps to do (/aside continue)',
      '1 done One',
      '↳ blue it is.',
      '2 to do Two',
      '3 to do Three',
      '4 to do Dark mode',
      '5 to do Light mode',
    ])
  })

  test('/aside plan that reads the plan as the answer turn ends waits for the step that answer starts', async ($, on) => {
    const { w, sent, type, aside, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1')
    await type('go')
    await startTurn('go', 'a1')
    await type('+ dark mode', 'a1')
    let planned: Promise<string> | undefined
    w.beforeWrite = async key => {
      if (key !== 'plan:/proj') return
      w.beforeWrite = undefined
      planned = aside('plan')
      // Long enough for /aside plan to read the plan the end of the turn is still saving.
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }

    // The answer's end ends the step and starts the next, so the queue waits for that one's end.
    await endTurn('a1', 'answer', 'Result: went.')
    expect(await planned).toBe("Step 2 is running; once it ends, Claude organizes the queue into steps after the plan's own, and /aside continue goes on.")
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
  })

  test('a step that is interrupted organizes nothing, and the queue stays as it was', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')

    await endTurn('s1', 'aborted')
    await idle()
    expect(sent).toHaveLength(1)
    expect(toasts).toEqual(['Plan stopped: step 1 was interrupted; /aside plan organizes the queue'])
    expect((await shown()).slice(0, 3)).toEqual(['1 idea waiting', '1 idea dark mode', 'Plan: 3 of 3 steps to do (/aside run)'])
  })

  test('a queue emptied before the step ends sends nothing to organize, and the run goes on', async ($, on) => {
    const { sent, toasts, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await aside('clear')

    await endTurn('s1')
    await idle()
    expect(toasts).toEqual(['Step 1 done; step 2 runs now.'])
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('Do two.')
  })

  test('/aside plan with an empty queue while a step runs says so, and the run goes on', async ($, on) => {
    const { sent, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')

    expect(await aside('plan')).toBe('The queue is empty. Start a message with "+" to add an idea, or "+?" to comment on a copied fragment.')
    await endTurn('s1')
    await idle()
    expect(sent[1]).toContain('Do two.')
  })

  test('after the last step, or one /aside stop made the last, the queue is organized and the steps wait for /aside run', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    expect(await aside('stop')).toBe('The plan stops after step 1.')

    await endTurn('s1')
    await idle()
    expect(toasts).toEqual(['Step 1 done'])
    await startTurn(sent[1]!, 'p1')
    await savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await endTurn('p1')
    expect((await shown()).slice(1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 to do Two', '3 to do Three', '4 to do Dark mode'])

    // A plan run to its end makes way for the steps it was given to add.
    await aside('run all')
    await idle()
    await answer('s2')
    await answer('s3')
    await startTurn(sent.at(-1)!, 's4')
    await type('+ light mode', 's4')
    await aside('plan')
    await endTurn('s4')
    await idle()
    expect(toasts.at(-1)).toBe('Plan done: 4 steps')
    // With no step left to add after, the queue is organized as /aside plan would.
    expect(sent.at(-1)).toContain('Ideas:\n1. light mode (branch main)\n\nOrganize all of it')
    await startTurn(sent.at(-1)!, 'p2')
    await savePlan([{ title: 'Light mode', prompt: 'Add a light mode.' }])
    await endTurn('p2')
    expect((await shown()).slice(1)).toEqual(['Plan: 1 of 1 step to do (/aside run)', '1 to do Light mode'])
  })

  test('while a step runs, the pane\'s plan button organizes the queue once it ends, saying so in a toast alone', async ($, on) => {
    const { sent, toasts, logged, type, aside, savePlan, startTurn, endTurn, pressBand, pane, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    const lines = logged.length
    await pressBand()

    const ui = await pane()
    await ui.press({ key: 'plan' })
    await ui.unmount()
    await idle()
    expect(toasts).toEqual([LATER])
    expect(logged.slice(lines)).toEqual([])
    await endTurn('s1')
    await idle()
    expect(sent[1]).toContain(adding('S1. One (done)', 'S2. Two (to do)', 'S3. Three (to do)'))
  })

  // A run of STEPS whose step 1 ends with /aside plan asked during it, and the prompt that
  // adds the queue to the plan sent.
  const organizing = async (t: ReturnType<typeof world>, ...ideas: string[]) => {
    await t.savePlan(STEPS)
    await t.aside('run all')
    await t.idle()
    await t.startTurn(t.sent[0]!, 's1')
    for (const idea of ideas) await t.type(`+ ${idea}`, 's1')
    await t.aside('plan')
    await t.endTurn('s1')
    await t.idle()
  }

  test('the prompt that adds to a running plan names every step with where it stands, apart from the items, titles cut at 60', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([STEPS[0]!, { title: 'A step whose title runs on well past sixty characters, so it is cut short', prompt: 'Do the long one.' }])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await endTurn('s1')
    await idle()

    expect(sent[1]).toBe(
      [
        'My queue, collected while you were working, oldest first.',
        '',
        'Ideas:',
        '1. dark mode (branch main)',
        '',
        'The saved plan is under way, so its steps stay as they are, done or not. Plan only the items above, as new steps: save only those, and they are added after the last of these steps, none of which you repeat.',
        'S1. One (done)',
        'S2. A step whose title runs on well past sixty characters, so i… (to do)',
        '',
        'Organize all of it, and only organize it: do none of it and answer none of it yet. Use no tool but the mcp__aside__plan tool, so read nothing, run nothing and change nothing.',
        '- merge related items into one step and keep unrelated ones apart; a question is an item like any other, answered when its step runs;',
        '- order the steps so whatever the rest depends on comes first, and say why in a few words;',
        '- for each step, write a prompt I could send you as it is; it must stand on its own, file paths included;',
        '- leave items that look done, contradictory or unclear out of the steps: pass each to the tool as unclear, with its number and your question, and they go back to my queue;',
        '- when a step handles a comment that is a <!-- --> tag in a file, the step removes that tag.',
        'Then save the steps with the mcp__aside__plan tool and stop: I see the saved plan in a frame and run it with /aside run all (in order), /aside run (the next step) or /aside run N.',
        '',
        MARKER,
      ].join('\n'),
    )
  })

  test('a second /aside plan while Claude organizes the queue is refused, so the steps the first adds stand', async ($, on) => {
    const t = world($, on)
    await organizing(t, 'dark mode')
    await t.startTurn(t.sent[1]!, 'p1')
    await t.type('+ light mode', 'p1')

    expect(await t.aside('plan')).toBe('Claude has yet to organize what the last /aside plan handed over; /aside plan works again once it has.')
    await t.savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await t.endTurn('p1')
    await t.idle()
    expect(t.sent).toHaveLength(2)
    expect(await t.shown()).toEqual([
      'Plan paused after step 1 (to organize the queue), 3 of 4 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
      '4 to do Dark mode',
      '1 idea waiting',
      '1 idea light mode',
    ])
  })

  test('while the prompt that adds waits behind a turn of the person\'s own, a second /aside plan is refused, and the steps it adds then stand', async ($, on) => {
    const t = world($, on)
    await organizing(t, 'dark mode')
    await t.startTurn('a message queued during step 1', 'u1')
    await t.type('+ light mode', 'u1')

    expect(await t.aside('plan')).toBe('Claude has yet to organize what the last /aside plan handed over; /aside plan works again once it has.')
    await t.endTurn('u1')
    await t.startTurn(t.sent[1]!, 'p1')
    await t.savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await t.endTurn('p1')
    expect((await t.shown()).slice(-6, -2)).toEqual(['1 done One', '2 to do Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('saved twice in the turn that adds to the plan, the second save takes the place of what the first added', async ($, on) => {
    const t = world($, on)
    await organizing(t, 'dark mode')
    await t.startTurn(t.sent[1]!, 'p1')

    await t.savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await t.savePlan([{ title: 'Dark and light', prompt: 'Add both modes.' }])
    await t.endTurn('p1')
    expect((await t.shown()).slice(-5, -1)).toEqual(['1 done One', '2 to do Two', '3 to do Three', '4 to do Dark and light'])
  })

  test('continue pressed while Claude organizes the queue starts the next step, and the steps saved still go after the plan\'s own', async ($, on) => {
    const t = world($, on)
    await organizing(t, 'dark mode')
    await t.startTurn(t.sent[1]!, 'p1')

    expect(await t.aside('continue')).toBe('Going on with the plan from step 2. /aside stop stops after the current one.')
    await t.idle()
    expect((await t.savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])).deny).toBeUndefined()
    await t.endTurn('p1')
    await t.idle()
    expect(t.sent.at(-1)).toContain('Do two.')
    expect((await t.shown()).slice(0, -1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 running Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('a step that never runs, stopped before it starts or its prompt dropped, says /aside plan organizes the queue', async ($, on) => {
    const { w, sent, toasts, type, aside, savePlan, idle } = world($, on)
    await type('+ dark mode')
    await savePlan(STEPS)
    await aside('run all')
    expect(await aside('plan')).toBe(LATER)
    expect(await aside('stop')).toBe('The plan stopped before step 1; /aside plan organizes the queue.')
    await idle()
    expect(sent).toEqual([])

    w.isDropping = true
    await aside('run all')
    await aside('plan')
    await idle()
    expect(sent).toEqual([])
    expect(toasts).toEqual(['Could not send step 1 of the plan: blocked by a hook; /aside plan organizes the queue'])
  })

  test('an interrupted step after /aside plan and a clear offers nothing to organize', async ($, on) => {
    const { sent, toasts, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await aside('clear')

    await endTurn('s1', 'aborted')
    expect(toasts).toEqual(['Plan stopped: step 1 was interrupted'])
  })

  test('an /aside plan that lands as the last step ends hands the queue over at once', async ($, on) => {
    const { w, sent, toasts, clock, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([STEPS[0]!])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    let said = Promise.resolve('')
    w.beforeWrite = async key => {
      if (!key.startsWith('plan:')) return
      w.beforeWrite = undefined
      said = aside('plan')
      await clock.settle()
    }

    await endTurn('s1')
    await idle()
    expect(await said).toBe('Organizing 1 idea.')
    expect(toasts).toEqual(['Plan done: 1 step'])
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('Ideas:\n1. dark mode (branch main)\n\nOrganize all of it')
  })

  test('an /aside plan that lands as a step of a chain ends waits for the next step, and nothing goes beside it', async ($, on) => {
    const { w, sent, clock, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    let said = Promise.resolve('')
    w.beforeWrite = async key => {
      if (!key.startsWith('plan:')) return
      w.beforeWrite = undefined
      said = aside('plan')
      await clock.settle()
    }

    await endTurn('s1')
    await idle()
    expect(await said).toBe(LATER.replace('Step 1', 'Step 2'))
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('Do two.')
    expect((await shown()).slice(-2)).toEqual(['1 idea waiting', '1 idea dark mode'])
  })

  test('once the turn that adds to the plan is over, a plan saved later replans as usual', async ($, on) => {
    const t = world($, on)
    await organizing(t, 'dark mode')
    await t.startTurn(t.sent[1]!, 'p1')
    await t.savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await t.endTurn('p1')

    await t.savePlan([{ title: 'Fresh', prompt: 'Do it.' }])
    expect((await t.shown()).slice(1)).toEqual(['Plan: 1 of 2 steps to do (/aside run)', '1 done One', '2 to do Fresh'])
  })

  test('a plan saved in a turn that is not the one that adds replans as usual', async ($, on) => {
    const t = world($, on)
    await organizing(t, 'dark mode')
    await t.startTurn('a turn aside did not see begin', 'p1')
    await t.endTurn('p1')
    await t.aside('continue')
    await t.idle()
    await t.answer('s2')
    expect(await t.aside('stop')).toBe('The plan stopped before step 3.')

    await t.savePlan([{ title: 'Fresh', prompt: 'Do it.' }])
    expect((await t.shown()).slice(-3)).toEqual(['1 done One', '2 done Two', '3 to do Fresh'])
  })

  // /aside continue pressed as step 1's end is handing the queue over, so step 2's prompt goes
  // out ahead of the one that adds, and then step 2 runs to its end.
  const continuedEarly = async (t: ReturnType<typeof world>) => {
    await t.savePlan(STEPS)
    await t.aside('run all')
    await t.idle()
    await t.startTurn(t.sent[0]!, 's1')
    await t.type('+ dark mode', 's1')
    await t.aside('plan')
    t.w.beforeWrite = async key => {
      if (!key.startsWith('taken:')) return
      t.w.beforeWrite = undefined
      void t.aside('continue')
      await t.clock.settle()
    }
    await t.endTurn('s1')
    await t.idle()
    expect(t.sent[1]).toContain('Do two.')
    expect(t.sent[2]).toContain('The saved plan is under way')
    await t.startTurn(t.sent[1]!, 's2')
    await t.endTurn('s2')
    await t.idle()
    await t.startTurn(t.sent[2]!, 'p1')
  }

  test('a step that runs ahead of the prompt that adds leaves its steps to be added after the plan\'s own', async ($, on) => {
    const t = world($, on)
    await continuedEarly(t)

    expect((await t.savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])).deny).toBeUndefined()
    await t.endTurn('p1')
    expect((await t.shown()).slice(0, -1)).toEqual(['Plan: 2 of 4 steps to do (/aside run)', '1 done One', '2 done Two', '3 running Three', '4 to do Dark mode'])
  })

  test('a step that runs ahead of the prompt that adds leaves its hand-over to be given back when nothing is saved', async ($, on) => {
    const t = world($, on)
    await continuedEarly(t)

    await t.endTurn('p1')
    expect(t.toasts.at(-1)).toBe('No plan was saved: 1 entry back in the queue.')
    expect((await t.shown()).slice(-2)).toEqual(['1 idea waiting', '1 idea dark mode'])
  })

  test('a plan run to its end before the prompt that adds is organized makes way for its steps, saved once or twice', async ($, on) => {
    const { w, sent, clock, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([STEPS[0]!, STEPS[1]!])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    w.beforeWrite = async key => {
      if (!key.startsWith('taken:')) return
      w.beforeWrite = undefined
      void aside('continue')
      await clock.settle()
    }
    await endTurn('s1')
    await idle()
    await startTurn(sent[1]!, 's2')
    await endTurn('s2')
    await idle()
    await startTurn(sent[2]!, 'p1')

    await savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await savePlan([{ title: 'Dark and light', prompt: 'Add both modes.' }])
    await endTurn('p1')
    expect((await shown()).slice(1)).toEqual(['Plan: 1 of 1 step to do (/aside run)', '1 to do Dark and light'])
  })

  test('a mark another session left on the plan is not this session\'s: a plan saved here replans', async ($, on) => {
    const { sent, type, aside, shown, savePlan, startTurn, endTurn, fromAnotherSession, idle } = world($, on)
    await type('+ light mode')
    fromAnotherSession('plan:/proj', { steps: [{ ...STEPS[0]!, isDone: true }, STEPS[1]!, STEPS[2]!], adding: { after: 3, sessionId: 'session-2', turnId: 'p1' } })
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')

    await savePlan([STEPS[1]!, STEPS[2]!, { title: 'Light mode', prompt: 'Add a light mode.' }])
    await endTurn('p1')
    expect((await shown()).slice(1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 to do Two', '3 to do Three', '4 to do Light mode'])
  })

  test('a prompt that adds, dropped beneath the plugin, gives the entries back, and the next /aside plan replans', async ($, on) => {
    const { w, sent, toasts, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    w.isDropping = true
    await endTurn('s1')
    await idle()
    expect(toasts.at(-1)).toBe('Could not hand the queue over (blocked by a hook); the entries are back in it')
    expect((await shown()).slice(-2)).toEqual(['1 idea waiting', '1 idea dark mode'])

    await aside('plan')
    await idle()
    expect(sent.at(-1)).toContain('S1. Two\n   Do two.')
    await startTurn(sent.at(-1)!, 'p1')
    await savePlan([{ title: 'Fresh', prompt: 'Do it.' }])
    await endTurn('p1')
    expect((await shown()).slice(-2)).toEqual(['1 done One', '2 to do Fresh'])
  })

  test('a planning turn that saves no steps gives the queue back, and the run stays paused', async ($, on) => {
    const { sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await endTurn('s1')
    await idle()

    await startTurn(sent[1]!, 'p1')
    await endTurn('p1')
    expect(await shown()).toEqual([
      'Plan paused after step 1 (to organize the queue), 2 of 3 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
      '1 idea waiting',
      '1 idea dark mode',
    ])
  })
})

describe('what a run keeps', () => {
  test('each step keeps the result its answer gives, in markdown too, or else its last paragraph, and /aside shows it under the step', async ($, on) => {
    const { aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await answer('s1', 'Done.\n\n- **Result**: one is in place, nothing open.')
    await answer('s2', 'There is no result line here.\n\nThe last paragraph says what happened.')

    expect(await shown()).toEqual([
      'Plan: 1 of 3 steps to do (/aside run)',
      '1 done One',
      '↳ one is in place, nothing open.',
      '2 done Two',
      '↳ The last paragraph says what happened.',
      '3 running Three',
      'The queue is empty.',
    ])
  })

  test('the last step of a run gets what every step done said, those before a pause included', async ($, on) => {
    const { sent, toasts, aside, savePlan, answer, idle } = world($, on)
    await savePlan([...STEPS, { title: 'Four', prompt: 'Do four.' }])
    await aside('run 1')
    await idle()
    await answer('s1', 'Result: one is in place.')

    await aside('run all')
    await idle()
    expect(sent.at(-1)).toBe(
      `Do two.\n\n(Step 2 of 4 of the queue plan, "Two", sent by the aside plugin.\nPlan: 1 One (done) · 2 Two (this one) · 3 Three (to do) · 4 Four (to do).\n${NEXT})`,
    )
    await answer('s2', 'Result: two works.')
    await answer('s3', 'Result: three is half done; the tests wait.')
    expect(sent.at(-1)).toBe(
      [
        'Do four.',
        '',
        '(Step 4 of 4 of the queue plan, "Four", sent by the aside plugin.',
        'Plan: 1 One (done) · 2 Two (done) · 3 Three (done) · 4 Four (this one).',
        `${last('1 One: one is in place.', '2 Two: two works.', '3 Three: three is half done; the tests wait.')})`,
      ].join('\n'),
    )
    await answer('s4', 'Result: four is done.', 65 * 60_000)
    expect(toasts.at(-1)).toBe('Plan done: 4 steps in 1 h 5 min')
  })
})

describe('the title of a step made of an entry', () => {
  const LONG = 'teraz dostałem wiadomość, że praca została skończona, a review w tle nadal działa, i później pewnie jeszcze inne kroki'

  test('a long entry run as a step is named by the small model, and a short one keeps its text', async ($, on) => {
    const { w, asked, type, aside, shown, idle } = world($, on, { tidy: {} })
    w.titleReply = '<title>Przedwczesne Plan done przy review w tle</title>'
    await type(`+ ${LONG}\n+ dark mode`)
    await idle()
    const before = asked.length
    expect(await aside('run all')).toBe('Running 2 entries one by one. /aside stop stops after the current one.')
    await idle()

    expect(asked).toHaveLength(before + 1)
    expect((await aside()).split('\n').filter(line => /^ +\d +(running|to do) /.test(line))).toEqual([
      '  1  running  Przedwczesne Plan done przy review w tle',
      '  2  to do    dark mode',
    ])
    expect((await shown()).length).toBeGreaterThan(0)
  })

  test('with no title from the model, or with tidy off, a step keeps the first 120 characters', async ($, on) => {
    const { asked, type, aside, idle } = world($, on, { tidy: {} })
    await type(`+ ${LONG} ${LONG}`)
    await idle()
    await aside('run')
    await idle()

    expect((await aside()).split('\n')[2]).toBe(`  1  running  ${`${LONG} ${LONG}`.slice(0, 119).trimEnd()}…`)
    expect(asked.at(-1)).toContain('<note>')
  })

  test('/aside run N names the entry it runs', async ($, on) => {
    const { w, type, aside, idle } = world($, on, { tidy: {} })
    w.titleReply = '<title>Review w tle</title>'
    await type(`+ dark mode\n+ ${LONG}`)
    await idle()
    await aside('run 2')
    await idle()
    expect((await aside()).split('\n')[2]).toBe('  1  running  Review w tle')
  })

  test('a reply too long to be a title is left out', async ($, on) => {
    const { w, type, aside, idle } = world($, on, { tidy: {} })
    w.titleReply = `<title>${'a long reply '.repeat(8)}</title>`
    await type(`+ ${LONG}`)
    await idle()
    await aside('run 1')
    await idle()
    expect((await aside()).split('\n')[2]).toBe(`  1  running  ${LONG}`)
  })

  test('the model reads the text typed alone, never the quote it was typed about', async ($, on) => {
    const { w, asked, write, type, aside, idle } = world($, on, { tidy: {}, files: { [REPORT_PATH]: REPORT }, clip: 'Revenue grew by 12% in the third quarter' })
    w.titleReply = '<title>Kwartał</title>'
    await write(REPORT_PATH)
    await type(`+? ${LONG}`)
    await idle()
    await aside('run 1')
    await idle()

    expect(asked.at(-1)).toContain(LONG)
    expect(asked.at(-1)).not.toContain('Revenue')
  })

  test('with tidy off, no model is asked', { options: { tidy: 'off' } }, async ($, on) => {
    const { w, asked, type, aside, idle } = world($, on)
    w.titleReply = '<title>X</title>'
    await type(`+ ${LONG}`)
    await aside('run')
    await idle()

    expect(asked).toEqual([])
  })

  test('a title that comes after the plan has changed is not written over it', async ($, on) => {
    const { w, type, aside, idle, fromAnotherSession } = world($, on, { tidy: {} })
    w.titleReply = '<title>Late title</title>'
    await type(`+ ${LONG}`)
    await idle()
    // Another session puts a plan of its own in place while the model thinks.
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await fromAnotherSession('plan:/proj', { steps: [{ title: LONG, prompt: 'Something else.' }] })
    }
    await aside('run')
    await idle()

    expect(await aside()).not.toContain('Late title')
  })
})

describe('a step an earlier process left running', () => {
  const LEFT = { step: 0, isChain: true, sessionId: 'session-1', turnId: 'before-resume', startedAt: 0 }

  test('/aside stop ends it as it stands', async ($, on) => {
    const { aside, shown, fromAnotherSession } = world($, on)
    await fromAnotherSession('plan:/proj', { steps: STEPS, active: LEFT })

    expect(await aside('stop')).toBe('Step 1 is done as it stands, and the plan stops there.')
    expect((await shown()).slice(1, 3)).toEqual(['Plan: 2 of 3 steps to do (/aside run) · 1 s so far', '1 done One'])
  })

  test('/aside continue ends it and goes on with the next step', async ($, on) => {
    const { sent, aside, idle, fromAnotherSession } = world($, on)
    await fromAnotherSession('plan:/proj', { steps: STEPS, active: LEFT })

    expect(await aside('continue')).toBe('Step 1 done; going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
  })

  test('/aside continue on the last step left running sums the run up in the next turn, which ends it', async ($, on) => {
    const { sent, aside, shown, startTurn, endTurn, idle, fromAnotherSession } = world($, on)
    const steps = [{ ...STEPS[0], isDone: true, ms: 60_000 }, STEPS[1]]
    await fromAnotherSession('plan:/proj', { steps, active: { ...LEFT, step: 1 } })
    await aside('continue')
    await idle()
    await startTurn(sent.at(-1)!, 'e1')
    await endTurn('e1', 'answer', 'Result: summed up.')
    await idle()

    expect((await shown()).find(line => line.startsWith('Plan'))).toMatch(/^Plan done: 2 steps/)
  })

  test('a step whose turn runs in this process now is not left: /aside stop stops after it', async ($, on) => {
    const { sent, aside, savePlan, startTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')

    expect(await aside('stop')).toBe('The plan stops after step 1.')
    expect(await aside('continue')).not.toContain('Step 1 done')
  })
})

// The step running as every release up to 0.37.1 stored it: flags whose combination is the
// state the plugin now reads (readActive in hooks/core/step.ts). Each is planted as the store
// holds it and read back through what the person sees (6.2).
describe('the step running as an earlier release stored it', () => {
  const planted = (active: unknown) => ({ 'plan:/proj': { steps: [...STEPS], active } })
  const run = { step: 0, isChain: true, sessionId: 'session-1' }

  test('pausedFor alone is a step waiting for your answer', async ($, on) => {
    const { aside, shown } = world($, on, { stored: planted({ ...run, pausedFor: 'which design' }) })

    expect((await shown())[0]).toBe('Plan waits at step 1 (which design), 3 of 3 steps to do (/aside continue)')
    expect(await aside('run 2')).toBe('Step 1 waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.')
  })

  test('pausedFor with isAnswered is a step that has had an answer and asks for another', async ($, on) => {
    const { aside, shown } = world($, on, { stored: planted({ ...run, pausedFor: 'which design', isAnswered: true }) })

    expect((await shown())[0]).toBe('Plan waits at step 1 (answered), 3 of 3 steps to do (/aside continue)')
    expect(await aside('run 2')).toBe(
      "Step 1 waits: answer again, and Claude's reply ends it, or /aside continue ends it and goes on; /aside stop ends it there.",
    )
  })

  test('isAway with work left is a step going on in the background', async ($, on) => {
    const { aside, shown } = world($, on, { stored: planted({ ...run, isAway: true, background: [{ taskId: 'w1', what: 'review' }] }) })

    expect((await shown()).slice(0, 3)).toEqual(['Plan: 3 of 3 steps to do (/aside run)', '1 running One', '↳ in the background: review'])
    expect(await aside('run 2')).toBe('Step 1 goes on in the background (review); /aside continue ends it and goes on, /aside stop ends it there.')
  })

  test('isAway beside pausedFor is a step waiting for your answer, not on its work', async ($, on) => {
    const stored = planted({ ...run, isAway: true, pausedFor: 'which fix', background: [{ taskId: 'w1', what: 'review' }] })
    const { aside, shown } = world($, on, { stored })

    expect((await shown())[0]).toBe('Plan waits at step 1 (which fix), 3 of 3 steps to do (/aside continue)')
    expect(await aside('run 2')).toBe('Step 1 waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.')
  })

  test('isEnding with no turn is a step continue or stop already ended, done as it stands', async ($, on) => {
    const { aside, shown } = world($, on, { stored: planted({ ...run, isEnding: true, result: 'half done' }) })

    expect(await aside('stop')).toBe('Step 1 is done as it stands, and the plan stops there.')
    expect((await shown()).slice(1, 4)).toEqual(['Plan: 2 of 3 steps to do (/aside run)', '1 done One', '↳ half done'])
  })
})
