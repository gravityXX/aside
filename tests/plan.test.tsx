import { describe, expect, test } from 'claude-code/testing'

import { REPORT, REPORT_PATH, STEPS, world } from './world'

const MARKER = '(Composed by the aside plugin from my queued notes, not typed by me as a message.)'

// The lines under each step of a plan of several, as Claude reads them.
const RESULT = 'End your reply with one line that starts "Result: " and says in one sentence what you did and what is still open.'
const NEXT = [
  'Do this step only, not the work of the steps after it; the next one is sent when you answer. If it is done already, say so.',
  'If you need my answer first, or something blocks this step, call the mcp__aside__wait tool and stop.',
  RESULT,
].join('\n')
const ALONE = `Do this step only, not the work of the other steps. If it is done already, say so.\n${RESULT}`
// The last step of a run, with what the steps done said.
const last = (...said: string[]) =>
  [
    'Do this step only; it is the last one of this run. If it is done already, say so.',
    ...(said.length > 0 ? ['What the steps done said:', ...said] : []),
    'Write the "Result: " line for this step, then end your reply with "## Summary of the run": one line per step of the plan on what was done, then what is still open (questions, anything paused, skipped or blocked), then what to do next.',
  ].join('\n')

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
        'Then save the steps with the mcp__aside__plan tool and stop: I see the saved plan in a frame and run it with /aside run (all, in order) or /aside run N.',
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

  test('/aside run all sends the queue as it is, to be worked through now', async ($, on) => {
    const { sent, type, aside, idle } = world($, on)
    await type('+ a\n+? b')

    expect(await aside('run all')).toBe('Sending 1 idea and 1 comment.')
    await idle()
    expect(sent).toEqual([
      [
        'My queue, collected while you were working, oldest first.',
        '',
        'Ideas:',
        '1. a (branch main)',
        '',
        'Comments on what you wrote (question, change, drop, dig deeper):',
        'Not tied to a file:',
        '  2. [question]: b',
        '',
        'Work through all of it now, in this order, in this one reply:',
        '- answer the questions first;',
        '- then the changes, drops and things to dig into, then the ideas;',
        '- when you handle a comment that is a <!-- --> tag in a file, remove that tag;',
        '- if an item is unclear or contradicts another, ask instead of guessing.',
        '',
        MARKER,
      ].join('\n'),
    ])
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
    await aside('run')
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
    await aside('run')
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
    await aside('run')
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

  test('with no plan, /aside run sends each entry as a step of its own, one after another', async ($, on) => {
    const { sent, write, type, aside, shown, answer, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)
    await type('+ dark mode\n+! @docs/report.md:5 as a table')

    expect(await aside('run')).toBe('Running 3 entries one by one. /aside stop stops after the current one.')
    expect(await shown()).toEqual([
      'The queue is empty.',
      'Tags in files',
      '· question is this the same for Poland',
      '↳ docs/report.md:9 · "Costs stayed flat across all regions." · handed over',
      'Plan: 3 of 3 steps to do (/aside run)',
      '1 running dark mode',
      '2 to do as a table',
      '3 to do is this the same for Poland',
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
        'and ask your question about each item left out, if any. /aside run runs the steps in order; /aside run N runs one.',
    ])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 3 of 3 steps to do (/aside run)', '1 to do One', '2 to do Two', '3 to do Three'])

    expect(await aside('run')).toBe('Running the plan: 3 steps, from step 1. /aside stop stops after the current one.')
    await idle()
    await answer('s1', 'Did one.\n\nResult: one is in place.', 40_000)
    await answer('s2', 'Did two.\n\n**Result:** two works, one question is open.', 20 * 60_000)
    await answer('s3', 'Result: three is done.\n\n## Summary of the run\n1 One: in place.', 3 * 60_000)
    expect(sent).toEqual([
      `Do one.\n\n(Step 1 of 3 of the queue plan, "One", sent by the aside plugin.\nPlan: 1 One (this one) · 2 Two (to do) · 3 Three (to do).\n${NEXT})`,
      `Do two.\n\n(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.\nPlan: 1 One (done) · 2 Two (this one) · 3 Three (to do).\n${NEXT})`,
      `Do three.\n\n(Step 3 of 3 of the queue plan, "Three", sent by the aside plugin.\nPlan: 1 One (done) · 2 Two (done) · 3 Three (this one).\n${last('1 One: one is in place.', '2 Two: two works, one question is open.')})`,
    ])
    expect(toasts).toEqual(['Plan done: 3 steps in 24 min'])
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
    await aside('run')
    await idle()
    await answer('s1')
    await type('+ a\n+ b\n+ c')

    expect(await aside('run 3')).toBe('Running entry 3: c')
    await idle()
    expect(sent.at(-1)).toBe('c (branch main)\n\n(Step 1 of 1 of the queue plan, "c", sent by the aside plugin.)')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea a', '2 idea b', 'Plan: 1 of 1 step to do (/aside run)', '1 running c'])
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
    expect(toasts).toEqual(['Step 1 done'])
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

  test('a step that needs an answer pauses the plan with the wait tool, and /aside run goes on from the next step', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')

    const paused = await $.tool.call({ tool: 'mcp__aside__wait', reason: 'needs your yes on the design' } as never)
    expect(paused.result).toBe('The plan pauses after this step. End your reply with your question; the user continues with /aside run.')
    await endTurn('s1')
    await idle()
    expect(sent).toHaveLength(1)
    expect(toasts).toEqual(['Plan paused after step 1: needs your yes on the design. /aside continue goes on.'])
    expect(await shown()).toEqual([
      'The queue is empty.',
      'Plan paused after step 1 (needs your yes on the design), 2 of 3 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
    ])

    expect(await aside('run')).toBe('Going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    expect(sent[1]).toContain('Do two.')
  })

  test('a paused run of chosen steps goes on with the steps it named, and /aside continue does what run does', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan([...STEPS, { title: 'Four', prompt: 'Do four.' }])
    await aside('run 3 1 2')
    await idle()
    await startTurn(sent[0]!, 's3')
    await $.tool.call({ tool: 'mcp__aside__wait', reason: 'which config to cache' } as never)
    await endTurn('s3')
    await idle()
    expect(sent).toHaveLength(1)

    expect(await aside('continue')).toBe('Going on with the plan from step 1: steps 1, 2. /aside stop stops after the current one.')
    await idle()
    await answer('s1')
    await answer('s2')
    expect(sent.map(text => text.split('\n')[0])).toEqual(['Do three.', 'Do one.', 'Do two.'])
    expect(toasts.at(-1)).toBe('Step 2 done')
    expect((await shown()).slice(1)).toEqual(['Plan: 1 of 4 steps to do (/aside run)', '1 done One', '2 done Two', '3 done Three', '4 to do Four'])
  })

  test('/aside stop drops a paused run, and /aside run then starts again from the first step to do', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 3 1')
    await idle()
    await startTurn(sent[0]!, 's3')
    await $.tool.call({ tool: 'mcp__aside__wait', reason: 'x' } as never)
    await endTurn('s3')

    expect(await aside('stop')).toBe('Dropped the paused run. /aside run starts the plan again from its first step to do.')
    expect((await shown())[1]).toBe('Plan: 2 of 3 steps to do (/aside run)')
    expect(await aside('stop')).toBe('Nothing is running.')
    expect(await aside('run')).toBe('Running the plan: 2 steps, from step 1. /aside stop stops after the current one.')
  })

  test('a step run by its number after a pause starts a run of its own, and the pause is gone', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'mcp__aside__wait', reason: 'x' } as never)
    await endTurn('s1')

    expect(await aside('run 3')).toBe('Running step 3: Three')
    await idle()
    await answer('s3')
    expect(sent).toHaveLength(2)
    expect((await shown())[1]).toBe('Plan: 1 of 3 steps to do (/aside run)')
  })

  test('when the store refuses the pause, the wait tool tells Claude to call it again', async ($, on) => {
    const { w, sent, aside, savePlan, startTurn, wait, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    w.isStoreFull = true

    expect((await wait('x')).deny).toBe('aside could not pause the plan (the store is full); call the tool again')
  })

  test('when the store fails at the start or the end of a step, aside says so in a toast', async ($, on) => {
    const { w, sent, toasts, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
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
    await aside('run')
    await idle()
    await answer('s1')

    await startTurn(sent.at(-1)!, 's2')
    expect(await aside('stop')).toBe('The plan stops after step 2.')
    await endTurn('s2')
    await idle()
    expect(sent).toHaveLength(2)
    expect(toasts).toEqual(['Step 2 done'])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 1 of 3 steps to do (/aside run)', '1 done One', '2 done Two', '3 to do Three'])
  })

  test('/aside stop between two steps keeps the next one from going out', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
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
    await aside('run')
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
    expect(await aside('run')).toBe('Step 3 is running. /aside stop stops after it.')
    await endTurn('s3', 'aborted')
    expect(toasts).toEqual(['Plan stopped: step 3 was interrupted'])
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 3 of 3 steps to do (/aside run)', '1 to do One', '2 to do Two', '3 to do Three'])
  })

  test('a step prompt dropped beneath the plugin lets the plan go', async ($, on) => {
    const { w, toasts, aside, savePlan, idle } = world($, on)
    await savePlan(STEPS)
    w.isDropping = true

    await aside('run')
    await idle()
    expect(toasts).toEqual(['Could not send step 1 of the plan: blocked by a hook'])
    expect(await aside('stop')).toBe('Nothing is running.')
  })

  test('/aside run runs the saved plan first, then the queue entry by entry', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    await type('+ extra')

    expect(await aside('run')).toBe('Running the plan: 1 step, from step 1. /aside stop stops after the current one.')
    await idle()
    await startTurn(sent[0]!, 'x1')
    await endTurn('x1')

    expect(await aside('run')).toBe('Running 1 entry one by one. /aside stop stops after the current one.')
    await idle()
    expect(sent.at(-1)).toBe('extra (branch main)\n\n(Step 1 of 1 of the queue plan, "extra", sent by the aside plugin.)')
  })

  test('/aside undo waits while a step runs, so nothing is done twice', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, idle } = world($, on)
    await type('+ a')
    await aside('plan')
    await idle()
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent.at(-1)!, 's1')

    expect(await aside('undo')).toBe('Step 1 of the plan is running; /aside stop first, so nothing is done twice.')
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

  test('afterClaudeAnswers run all sends the queue as it is', { options: { afterClaudeAnswers: 'run all' } }, async ($, on) => {
    const { sent, type, startTurn, endTurn, idle } = world($, on)
    await startTurn('build', 't1')
    await type('+ dark mode', 't1')
    await endTurn('t1')
    await idle()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Ideas:\n1. dark mode (branch main)')
    expect(sent[0]).toContain('Work through all of it now')
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
    await aside('run')
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
    await aside('run')
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
      'The queue is empty.',
      'Plan paused after step 1 (to organize the queue), 3 of 4 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
      '4 to do Dark mode',
    ])
    expect(await aside('continue')).toBe('Going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    await answer('s2')
    await answer('s3')
    expect(sent.at(-1)).toContain('Add a dark mode.\n\n(Step 4 of 4 of the queue plan, "Dark mode"')
    await answer('s4')
    expect(toasts.at(-1)).toBe('Plan done: 4 steps')
  })

  test('a step that pauses for an answer keeps its question, and the queue is organized after it all the same', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await wait('which colours')

    await endTurn('s1')
    await idle()
    expect(toasts).toEqual(['Plan paused after step 1: which colours. /aside continue goes on.'])
    expect(sent[1]).toContain(adding('S1. One (done)', 'S2. Two (to do)', 'S3. Three (to do)'))
    await startTurn(sent[1]!, 'p1')
    await savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await endTurn('p1')
    expect((await shown())[1]).toBe('Plan paused after step 1 (which colours), 3 of 4 steps to do (/aside continue)')
  })

  test('a step that is interrupted organizes nothing, and the queue stays as it was', async ($, on) => {
    const { sent, toasts, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
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
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await aside('clear')

    await endTurn('s1')
    await idle()
    expect(toasts).toEqual([])
    expect(sent).toHaveLength(2)
    expect(sent[1]).toContain('Do two.')
  })

  test('/aside plan with an empty queue while a step runs says so, and the run goes on', async ($, on) => {
    const { sent, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
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
    await aside('run')
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
    await aside('run')
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
    await aside('run')
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
    await t.aside('run')
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
    await aside('run')
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
        'Then save the steps with the mcp__aside__plan tool and stop: I see the saved plan in a frame and run it with /aside run (all, in order) or /aside run N.',
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
      '1 idea waiting',
      '1 idea light mode',
      'Plan paused after step 1 (to organize the queue), 3 of 4 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
      '4 to do Dark mode',
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
    expect((await t.shown()).slice(-4)).toEqual(['1 done One', '2 to do Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('saved twice in the turn that adds to the plan, the second save takes the place of what the first added', async ($, on) => {
    const t = world($, on)
    await organizing(t, 'dark mode')
    await t.startTurn(t.sent[1]!, 'p1')

    await t.savePlan([{ title: 'Dark mode', prompt: 'Add a dark mode.' }])
    await t.savePlan([{ title: 'Dark and light', prompt: 'Add both modes.' }])
    await t.endTurn('p1')
    expect((await t.shown()).slice(-4)).toEqual(['1 done One', '2 to do Two', '3 to do Three', '4 to do Dark and light'])
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
    expect((await t.shown()).slice(1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 running Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('a step that never runs, stopped before it starts or its prompt dropped, says /aside plan organizes the queue', async ($, on) => {
    const { w, sent, toasts, type, aside, savePlan, idle } = world($, on)
    await type('+ dark mode')
    await savePlan(STEPS)
    await aside('run')
    expect(await aside('plan')).toBe(LATER)
    expect(await aside('stop')).toBe('The plan stopped before step 1; /aside plan organizes the queue.')
    await idle()
    expect(sent).toEqual([])

    w.isDropping = true
    await aside('run')
    await aside('plan')
    await idle()
    expect(sent).toEqual([])
    expect(toasts).toEqual(['Could not send step 1 of the plan: blocked by a hook; /aside plan organizes the queue'])
  })

  test('an interrupted step after /aside plan and a clear offers nothing to organize', async ($, on) => {
    const { sent, toasts, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
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
    await aside('run')
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
    await aside('run')
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
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea dark mode'])
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
    await t.aside('run')
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
    expect((await t.shown()).slice(1)).toEqual(['Plan: 2 of 4 steps to do (/aside run)', '1 done One', '2 done Two', '3 running Three', '4 to do Dark mode'])
  })

  test('a step that runs ahead of the prompt that adds leaves its hand-over to be given back when nothing is saved', async ($, on) => {
    const t = world($, on)
    await continuedEarly(t)

    await t.endTurn('p1')
    expect(t.toasts.at(-1)).toBe('No plan was saved: 1 entry back in the queue.')
    expect((await t.shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea dark mode'])
  })

  test('a plan run to its end before the prompt that adds is organized makes way for its steps, saved once or twice', async ($, on) => {
    const { w, sent, clock, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([STEPS[0]!, STEPS[1]!])
    await aside('run')
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
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    w.isDropping = true
    await endTurn('s1')
    await idle()
    expect(toasts.at(-1)).toBe('Could not hand the queue over (blocked by a hook); the entries are back in it')
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea dark mode'])

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
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await endTurn('s1')
    await idle()

    await startTurn(sent[1]!, 'p1')
    await endTurn('p1')
    expect(await shown()).toEqual([
      '1 idea waiting',
      '1 idea dark mode',
      'Plan paused after step 1 (to organize the queue), 2 of 3 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
    ])
  })
})

describe('what a run keeps', () => {
  test('each step keeps the result its answer gives, in markdown too, or else its last paragraph, and /aside shows it under the step', async ($, on) => {
    const { aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await answer('s1', 'Done.\n\n- **Result**: one is in place, nothing open.')
    await answer('s2', 'There is no result line here.\n\nThe last paragraph says what happened.')

    expect(await shown()).toEqual([
      'The queue is empty.',
      'Plan: 1 of 3 steps to do (/aside run)',
      '1 done One',
      '↳ one is in place, nothing open.',
      '2 done Two',
      '↳ The last paragraph says what happened.',
      '3 running Three',
    ])
  })

  test('the last step of a run gets what every step done said, those before a pause included', async ($, on) => {
    const { sent, toasts, aside, savePlan, answer, idle } = world($, on)
    await savePlan([...STEPS, { title: 'Four', prompt: 'Do four.' }])
    await aside('run 1')
    await idle()
    await answer('s1', 'Result: one is in place.')

    await aside('run')
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

describe('planning on a model of its own', () => {
  const SONNET = { options: { planModel: 'sonnet' } }
  const PLAN = '```json\n{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}], "unclear": [{"item": 2, "question": "Which login bug?"}]}\n```'

  test('with planModel sonnet, one call to Sonnet organizes the queue outside the conversation, and /aside plan shows the plan', SONNET, async ($, on) => {
    const { w, sent, planned, type, aside, shown } = world($, on)
    await type('+ dark mode')
    await type('+ fix the login bug')
    w.planReply = PLAN

    expect(await aside('plan')).toBe(
      ['Plan: 1 of 1 step to do (/aside run)', '', '  1  to do  Dark mode', '', 'Not in the plan, back in the queue', '', '  ·  idea  fix the login bug', '           ↳ Which login bug?'].join('\n'),
    )
    expect(sent).toEqual([])
    expect(planned.map(call => call.model)).toEqual(['sonnet'])
    expect(planned[0]!.prompt).toContain('Ideas:\n1. dark mode (branch main)\n2. fix the login bug (branch main)')
    expect(planned[0]!.prompt).toContain('Answer with this JSON object alone')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea fix the login bug', 'Plan: 1 of 1 step to do (/aside run)', '1 to do Dark mode'])
  })

  test('a planner that gives no plan leaves the queue as it was and says why', SONNET, async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ dark mode')

    expect(await aside('plan')).toBe('Sonnet gave no plan (the call failed); the queue is as it was.')
    w.planReply = 'Sorry, I would rather not.'
    expect(await aside('plan')).toBe('Sonnet gave no plan (its answer held no plan); the queue is as it was.')
    w.planReply = '{"steps": [], "unclear": []}'
    expect(await aside('plan')).toBe('Sonnet gave no plan (its answer held no plan); the queue is as it was.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
  })

  test('the planner keeps the steps still to do and the plan keeps those done first', SONNET, async ($, on) => {
    const { w, sent, planned, type, aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 1')
    await idle()
    await answer('s1')
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "Two", "prompt": "Do two."}, {"title": "Three and dark mode", "prompt": "Do three, then add a dark mode."}]}'

    await aside('plan')
    expect(sent).toHaveLength(1)
    expect(planned[0]!.prompt).toContain('S1. Two\n   Do two.\nS2. Three\n   Do three.')
    expect((await shown()).slice(-3)).toEqual(['1 done One', '2 to do Two', '3 to do Three and dark mode'])
  })

  test('while Claude works, the plan shows in the list pane at once', SONNET, async ($, on) => {
    const { w, panes, type, aside, startTurn } = world($, on)
    await startTurn('build the parser', 't1')
    await type('+ dark mode', 't1')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'

    expect(await aside('plan')).toBe(['Plan: 1 of 1 step to do (/aside run)', '', '  1  to do  Dark mode'].join('\n'))
    expect(panes).toEqual(['aside'])
  })

  test('afterClaudeAnswers plan with planModel haiku plans by itself once Claude answers, and says so in a toast', { options: { afterClaudeAnswers: 'plan', planModel: 'haiku' } }, async ($, on) => {
    const { w, sent, planned, toasts, logged, panes, type, startTurn, endTurn, idle } = world($, on)
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    await startTurn('build the parser', 't1')
    await type('+ dark mode', 't1')
    await endTurn('t1')
    await idle()

    expect(planned.map(call => call.model)).toEqual(['haiku'])
    expect(sent).toEqual([])
    expect(toasts).toEqual(['Haiku is organizing 1 idea.', 'Plan: 1 of 1 step to do (/aside run)'])
    expect(logged.at(-1)).toBe(['Plan: 1 of 1 step to do (/aside run)', '', '  1  to do  Dark mode'].join('\n'))
    expect(panes).toEqual([])
  })

  test('the planner is asked in full words, with its own system prompt, and its plan leaves nothing for undo', SONNET, async ($, on) => {
    const { w, planned, type, aside } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'

    await aside('plan')
    expect(planned[0]!.system).toBe(
      'You organize the notes a developer queued while Claude Code worked into a plan of steps that Claude Code then runs one by one. You see only the notes. Answer with one JSON object and nothing else.',
    )
    expect(planned[0]!.prompt).toBe(
      [
        'My queue, collected while you were working, oldest first.',
        '',
        'Ideas:',
        '1. dark mode (branch main)',
        '',
        'Organize all of it, and only organize it, as a plan of steps for Claude Code to run; "you" in the notes is Claude:',
        '- merge related items into one step and keep unrelated ones apart; a question is an item like any other, answered when its step runs;',
        '- order the steps so whatever the rest depends on comes first, and say why in a few words;',
        '- for each step, write a prompt I could send you as it is; it must stand on its own, file paths included;',
        '- leave items that look done, contradictory or unclear out of the steps: list each under unclear, with its number and your question, and they go back to my queue;',
        '- when a step handles a comment that is a <!-- --> tag in a file, the step removes that tag.',
        'Answer with this JSON object alone, no other text: {"steps": [{"title": "a few words", "prompt": "the whole prompt"}], "unclear": [{"item": 3, "question": "..."}]}',
      ].join('\n'),
    )
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })

  test('one planner at a time: a second /aside plan while it thinks is refused', SONNET, async ($, on) => {
    const { w, type, aside } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    let second = ''
    w.meanwhile = async () => {
      w.meanwhile = undefined
      second = await aside('plan')
    }

    await aside('plan')
    expect(second).toBe('Sonnet is still organizing the queue.')
  })

  test('the queue stays as it is while the planner thinks: an entry typed, a clear and an undo then lose nothing', SONNET, async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ dark mode')
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await type('+ other')
      await aside('clear')
      await aside('undo')
    }

    expect(await aside('plan')).toBe('Sonnet gave no plan (the call failed); the queue is as it was.')
    expect(await shown()).toEqual(['2 ideas waiting', '1 idea dark mode', '2 idea other'])
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await type('+ third')
    }
    await aside('plan')
    expect((await shown()).slice(0, 3)).toEqual(['1 idea waiting', '1 idea third', 'Plan: 1 of 1 step to do (/aside run)'])
  })

  test('a step started while the planner thinks keeps its plan, and the queue stays', SONNET, async ($, on) => {
    const { w, sent, type, aside, savePlan, idle } = world($, on)
    await savePlan(STEPS)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "New", "prompt": "Do new."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await aside('run 1')
      await idle()
    }

    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect(sent).toHaveLength(1)
  })

  test('a plan saved while the planner thinks is not saved over', SONNET, async ($, on) => {
    const { w, type, aside, savePlan, shown } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "New", "prompt": "Do new."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await savePlan(STEPS)
    }

    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect((await shown()).slice(-3)).toEqual(['1 to do One', '2 to do Two', '3 to do Three'])
  })

  test('a planner that only asks about the entries leaves them all in the queue, with its questions', SONNET, async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [], "unclear": [{"item": 1, "question": "Which colours?"}]}'

    expect(await aside('plan')).toBe(
      ['Sonnet made no plan, and asks about 1 entry; the queue is as it was.', '', 'Not in the plan, back in the queue', '', '  ·  idea  dark mode', '           ↳ Which colours?'].join('\n'),
    )
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}], "unclear": [{"item": 9, "question": "?"}]}'
    expect(await aside('plan')).toBe('Sonnet gave no plan (the items it left out were named wrong); the queue is as it was.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
  })

  test('a store that refuses the plan leaves the queue as it was and says why', SONNET, async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    w.refuseWrite = 1

    expect(await aside('plan')).toBe("Could not save Sonnet's plan (the store is full); the queue is as it was.")
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
  })

  // What the planner reads of a plan it adds to, after the queue.
  const ADDING = 'The saved plan is under way, so its steps stay as they are, done or not. Plan only the items above, as new steps: save only those, and they are added after the last of these steps, none of which you repeat.'
  const DARK = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'

  test('while a step runs, the planner adds its steps after the plan\'s own at once, and the run goes on to them', SONNET, async ($, on) => {
    const { w, sent, planned, panes, type, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    w.planReply = DARK

    const text = ['Plan: 4 of 4 steps to do (/aside run)', '', '  1  running  One', '  2  to do    Two', '  3  to do    Three', '  4  to do    Dark mode'].join('\n')
    expect(await aside('plan')).toBe(text)
    expect(planned[0]!.prompt).toContain(`\n\n${ADDING}\nS1. One (running)\nS2. Two (to do)\nS3. Three (to do)\n\n`)
    expect(planned[0]!.prompt).not.toContain('S1. One\n   Do one.')
    expect(panes).toEqual(['aside'])
    expect(sent).toHaveLength(1)

    await endTurn('s1')
    await idle()
    expect((await shown())[0]).toBe('The queue is empty.')
    await answer('s2')
    await answer('s3')
    expect(sent.at(-1)).toContain('Add a dark mode.\n\n(Step 4 of 4 of the queue plan, "Dark mode"')
  })

  test('a step that ends while the planner thinks, and the next that starts, change nothing it was given', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    w.planReply = DARK
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await endTurn('s1')
      await idle()
      await startTurn(sent[1]!, 's2')
    }

    expect(await aside('plan')).toBe(['Plan: 3 of 4 steps to do (/aside run)', '', '  1  done     One', '  2  running  Two', '  3  to do    Three', '  4  to do    Dark mode'].join('\n'))
  })

  test('a planner that answers while the step\'s end saves the plan waits for it, so both stand: the step done and the steps added', SONNET, async ($, on) => {
    const { w, sent, clock, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    w.planReply = DARK
    let reply = () => {}
    w.meanwhile = () => new Promise<void>(resolve => (reply = resolve))
    const planning = aside('plan')
    await clock.settle()
    w.beforeWrite = async key => {
      if (!key.startsWith('plan:')) return
      w.beforeWrite = undefined
      reply()
      await clock.settle()
    }

    await endTurn('s1')
    await planning
    await idle()
    expect(sent).toHaveLength(2)
    expect((await shown()).slice(1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 running Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('a step that ends just as the planner saves keeps both: the step done and the steps added', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    w.planReply = DARK
    let ending: Promise<unknown> = Promise.resolve()
    w.meanwhile = async () => {
      w.meanwhile = undefined
      ending = endTurn('s1')
    }

    await aside('plan')
    await ending
    await idle()
    expect(sent).toHaveLength(2)
    expect((await shown()).slice(1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 running Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('a pause, a stop or an interruption while the planner thinks keeps the steps it adds', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    w.planReply = DARK
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await wait('which colours')
      await endTurn('s1')
      await idle()
    }

    await aside('plan')
    expect((await shown()).slice(1)).toEqual([
      'Plan paused after step 1 (which colours), 3 of 4 steps to do (/aside continue)',
      '1 done One',
      '2 to do Two',
      '3 to do Three',
      '4 to do Dark mode',
    ])

    await aside('continue')
    await idle()
    await startTurn(sent.at(-1)!, 's2')
    await type('+ light mode', 's2')
    w.planReply = '{"steps": [{"title": "Light mode", "prompt": "Add a light mode."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await aside('stop')
      await endTurn('s2', 'aborted')
      await idle()
    }
    await aside('plan')
    expect((await shown()).slice(1)).toEqual(['Plan: 4 of 5 steps to do (/aside run)', '1 done One', '2 to do Two', '3 to do Three', '4 to do Dark mode', '5 to do Light mode'])
  })

  test('a run of named steps leaves the steps added to wait for /aside run', SONNET, async ($, on) => {
    const { w, sent, toasts, type, aside, shown, savePlan, startTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 2 1')
    await idle()
    await startTurn(sent[0]!, 's2')
    await type('+ dark mode', 's2')
    w.planReply = DARK
    await aside('plan')

    await answer('s2')
    await answer('s1')
    expect(sent).toHaveLength(2)
    expect(toasts.at(-1)).toBe('Step 1 done')
    expect((await shown()).slice(-2)).toEqual(['3 to do Three', '4 to do Dark mode'])
  })

  test('a plan replaced while the planner adds to it is not added to', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    w.planReply = DARK
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await endTurn('s1', 'aborted')
      await idle()
      await savePlan([{ title: 'Other', prompt: 'Do other.' }])
    }

    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect((await shown()).slice(0, 2)).toEqual(['1 idea waiting', '1 idea dark mode'])
  })

  test('a plan replaced while the planner adds to it is not added to, however close the new one is', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    const others = [
      [STEPS[0]!, { title: 'Two', prompt: 'Do two, and the dark mode.' }, STEPS[2]!],
      [STEPS[0]!, STEPS[1]!, { title: 'Third', prompt: 'Do three.' }],
      [STEPS[0]!, STEPS[1]!],
    ]
    await type('+ dark mode')
    w.planReply = DARK
    for (const [i, other] of others.entries()) {
      await savePlan(STEPS)
      await aside('run')
      await idle()
      await startTurn(sent.at(-1)!, `s${i}`)
      w.meanwhile = async () => {
        w.meanwhile = undefined
        await endTurn(`s${i}`, 'aborted')
        await idle()
        await savePlan(other)
      }

      expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
      expect((await shown()).slice(3)).toEqual(other.map((step, n) => `${n + 1} to do ${step.title}`))
    }
  })

  test('the planner adding to a running plan is asked in full words, every step with where it stands', SONNET, async ($, on) => {
    const { w, sent, planned, type, aside, savePlan, startTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 2')
    await idle()
    await startTurn(sent[0]!, 's2')
    await type('+ dark mode', 's2')
    w.planReply = DARK

    await aside('plan')
    expect(planned[0]!.prompt).toBe(
      [
        'My queue, collected while you were working, oldest first.',
        '',
        'Ideas:',
        '1. dark mode (branch main)',
        '',
        `${ADDING}`,
        'S1. One (to do)',
        'S2. Two (running)',
        'S3. Three (to do)',
        '',
        'Organize all of it, and only organize it, as a plan of steps for Claude Code to run; "you" in the notes is Claude:',
        '- merge related items into one step and keep unrelated ones apart; a question is an item like any other, answered when its step runs;',
        '- order the steps so whatever the rest depends on comes first, and say why in a few words;',
        '- for each step, write a prompt I could send you as it is; it must stand on its own, file paths included;',
        '- leave items that look done, contradictory or unclear out of the steps: list each under unclear, with its number and your question, and they go back to my queue;',
        '- when a step handles a comment that is a <!-- --> tag in a file, the step removes that tag.',
        'Answer with this JSON object alone, no other text: {"steps": [{"title": "a few words", "prompt": "the whole prompt"}], "unclear": [{"item": 3, "question": "..."}]}',
      ].join('\n'),
    )
  })

  test('a plan run to its end while the planner adds to it makes way for the steps added', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    w.planReply = DARK
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await endTurn('s1')
      await idle()
    }

    await aside('plan')
    expect(await shown()).toEqual(['The queue is empty.', 'Plan: 1 of 1 step to do (/aside run)', '1 to do Dark mode'])
    expect(sent).toHaveLength(1)
  })

  test('the pane\'s plan button says the planner\'s plan in one line', SONNET, async ($, on) => {
    const { w, toasts, type, pressBand, pane, idle } = world($, on)
    await type('+ dark mode\n+ fix the login bug')
    w.planReply = PLAN
    await pressBand()

    const ui = await pane()
    await ui.press({ key: 'plan' })
    await ui.unmount()
    await idle()
    expect(toasts.at(-1)).toBe('Plan: 1 of 1 step to do (/aside run); 1 entry left in the queue, with a question.')
  })

  test('an entry that leaves the queue while the planner thinks makes it save nothing: removed, or sent with run all', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, idle } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await aside('remove 1')
    }
    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect(await shown()).toEqual(['The queue is empty.'])

    await type('+ dark mode')
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await aside('run all')
      await idle()
    }
    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect(sent).toHaveLength(1)
    expect(await shown()).toEqual(['The queue is empty.'])
  })

  test('a tag handed over while the planner thinks makes it save nothing', SONNET, async ($, on) => {
    const { w, sent, write, aside, idle } = world($, on, { files: { [REPORT_PATH]: REPORT } })
    await write(REPORT_PATH)
    w.planReply = '{"steps": [{"title": "Poland", "prompt": "Check Poland."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await aside('run all')
      await idle()
    }

    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect(sent).toHaveLength(1)
  })

  test('a step run to its end while the planner thinks makes it save nothing', SONNET, async ($, on) => {
    const { w, type, aside, savePlan, answer, idle, shown } = world($, on)
    await savePlan([{ title: 'One', prompt: 'Do one.' }])
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "One", "prompt": "Do one."}, {"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await aside('run')
      await idle()
      await answer('s1')
    }

    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect((await shown()).slice(-2)).toEqual(['Plan done: 1 step', '1 done One'])
  })

  test('the planner waits for an entry still being tidied, and plans it as tidied', { options: { planModel: 'sonnet' } }, async ($, on) => {
    const { w, planned, clock, type, aside, shown } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    let release = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await held
    }
    await type('+ dark mod')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'

    const planning = aside('plan')
    await clock.settle()
    release()
    await planning
    expect(planned[0]!.prompt).toContain('1. Dark mode.')
    expect((await shown()).slice(0, 1)).toEqual(['The queue is empty.'])
  })

  test('two asks at once start one planner', SONNET, async ($, on) => {
    const { w, planned, type, aside } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'

    const answers = await Promise.all([aside('plan'), aside('plan')])
    expect(answers[1]).toBe('Sonnet is still organizing the queue.')
    expect(planned).toHaveLength(1)
  })

  test('a tag the planner planned shows as handed over, and one it asked about stays new', SONNET, async ($, on) => {
    const notes = ['# Notes', '<!-- ? why this -->', '', '<!-- ? and that -->'].join('\n')
    const { w, write, aside, shown } = world($, on, { files: { '/proj/notes.md': notes } })
    await write('/proj/notes.md')
    w.planReply = '{"steps": [{"title": "Why", "prompt": "Answer why."}], "unclear": [{"item": 2, "question": "Which one?"}]}'

    await aside('plan')
    expect((await shown()).filter(line => line.startsWith('↳ notes.md'))).toEqual(['↳ notes.md:2 · "# Notes" · handed over', '↳ notes.md:4 · "# Notes"'])
  })

  test('while Claude works on a narrow terminal, the plan goes into the transcript at once', { options: { planModel: 'sonnet' } }, async ($, on) => {
    const { w, logged, type, aside, startTurn } = world($, on, { isNarrow: true })
    await startTurn('build the parser', 't1')
    await type('+ dark mode', 't1')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'

    await aside('plan')
    expect(logged.at(-1)).toBe(['Plan: 1 of 1 step to do (/aside run)', '', '  1  to do  Dark mode'].join('\n'))
  })

  test('from the pane, the planner\'s questions go into the transcript, and undo then has nothing to bring back', SONNET, async ($, on) => {
    const { w, toasts, logged, type, aside, pressBand, pane, idle } = world($, on)
    await type('+ a')
    await aside('clear')
    await type('+ dark mode')
    w.planReply = '{"steps": [], "unclear": [{"item": 1, "question": "Which colours?"}]}'
    await pressBand()

    const ui = await pane()
    await ui.press({ key: 'plan' })
    await ui.unmount()
    await idle()
    expect(toasts.slice(-2)).toEqual(['Sonnet is organizing 1 idea.', 'Sonnet made no plan, and asks about 1 entry; the queue is as it was.'])
    expect(logged.at(-1)).toContain('↳ Which colours?')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    await aside('plan')
    expect(await aside('undo')).toBe('Nothing to bring back.')
  })
})
