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

  test('while a step runs, /aside plan and /aside run all are refused and send nothing', async ($, on) => {
    const { sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ z', 's1')

    expect(await aside('plan')).toBe('Step 1 is running. /aside stop stops after it.')
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
      'Plan done: 3 steps',
      '1 done One',
      '↳ one is in place.',
      '2 done Two',
      '↳ two works, one question is open.',
      '3 done Three',
      '↳ three is done.',
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
