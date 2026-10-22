import { describe, expect, test } from 'claude-code/testing'

import { launched, notice, notify, STEPS, world } from './world'

// A step whose turn leaves work going in the background, and a step whose turn never ends:
// both are steps with no turn of their own that something other than an answer moves on.

describe('a step with work in the background', () => {
  test('a step whose turn leaves a workflow going goes on in the background, and the turn its end brings ends it', async ($, on) => {
    const { sent, contexts, toasts, aside, shown, savePlan, startTurn, endTurn, idle, band } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.', 60_000)
    await idle()

    expect(sent).toHaveLength(1)
    expect(toasts.at(-1)).toBe('Step 1 goes on in the background (review); it ends once that work is done and Claude has answered it, or /aside continue ends it now.')
    expect((await shown()).slice(1, 3)).toEqual(['1 running One', '↳ 1 min · in the background: review'])
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▱▱▱ 0/3 · step 1 running in the background · ')
    await ui.unmount()
    expect(await aside('run 2')).toBe('Step 1 goes on in the background (review); /aside continue ends it and goes on, /aside stop ends it there.')

    await notify($, notice('w1', 'toolu_1'))
    expect(contexts.at(-1)).toEqual([
      '(Added by the aside plugin: this notification ends work in the background of step 1 of 3 of the queue plan, "One". This was the last of it, so the step ends with your reply. End your reply with one line that starts "Result: " and says in one sentence what the step has done and what is still open.)',
    ])
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await endTurn('n1', 'answer', 'Result: reviewed; two fixes.', 60_000)
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
    expect((await shown()).slice(1, 3)).toEqual(['1 done One', '↳ 2 min · reviewed; two fixes.'])
  })

  test('with two pieces of work, the step goes on until the last one ends, and an agent or a command counts as one', async ($, on) => {
    const { sent, contexts, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'find the docs', run_in_background: true, tool_use_id: 'toolu_a' } as never)
    await $.tool.call({ tool: 'Bash', command: 'sleep 9', description: 'wait for CI', run_in_background: true, tool_use_id: 'toolu_b' } as never)
    await endTurn('s1', 'answer', 'Result: started both.')
    expect((await shown())[2]).toBe('↳ in the background: find the docs, wait for CI')

    await notify($, notice('a7', 'toolu_a'))
    expect(contexts.at(-1)?.[0]).toContain('It still waits for: wait for CI, so it goes on once you reply.')
    await startTurn(notice('a7', 'toolu_a'), 'n1')
    await endTurn('n1', 'answer', 'Result: docs found.')
    expect((await shown())[2]).toBe('↳ in the background: wait for CI')

    await notify($, notice('b3', 'toolu_b'))
    await startTurn(notice('b3', 'toolu_b'), 'n2')
    await endTurn('n2', 'answer', 'Result: CI passed.')
    await idle()
    expect((await shown()).slice(1, 4)).toEqual(['Plan done: 1 step', '1 done One', '↳ CI passed.'])
  })

  test('work started outside the step\'s turn, or by an agent of its own, is not the step\'s', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_0' } as never)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1', agentId: 'sub1' } as never)
    await endTurn('s1', 'answer', 'Result: one.')
    await idle()
    expect((await shown()).slice(1, 3)).toEqual(['1 done One', '↳ one.'])
  })

  test('/aside stop ends a step that goes on in the background as it stands, and a late notification changes nothing', async ($, on) => {
    const { sent, contexts, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')

    expect(await aside('stop')).toBe('Step 1 is done as it stands, and the plan stops there.')
    await notify($, notice('w1', 'toolu_1'))
    expect(contexts.at(-1)).toEqual([])
    await idle()
    expect(sent.filter(text => text.includes('(Step 2 of 3'))).toEqual([])
    expect((await shown()).slice(2, 4)).toEqual(['1 done One', '↳ review started.'])
  })

  test('a step that waits for an answer and has work in the background goes on in the background once answered', async ($, on) => {
    const { sent, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('may I review')
    await endTurn('s1', 'answer', 'Result: asks.')
    await type('yes')
    await startTurn('yes', 'a1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('a1', 'answer', 'Result: review started.')
    await idle()

    expect(sent).toHaveLength(2)
    expect((await shown()).slice(1, 3)).toEqual(['1 running One', '↳ in the background: review'])
  })

  test('work stopped with TaskStop leaves the step, and the turn that stopped it ends the step', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped', task_id: 'b3', task_type: 'local_bash' } as never }))
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'the dev server', run_in_background: true, tool_use_id: 'toolu_b' } as never)
    await endTurn('s1', 'answer', 'Result: server up.')
    expect((await shown())[2]).toBe('↳ in the background: the dev server')

    await startTurn('stop the server', 'h1')
    await $.tool.call({ tool: 'TaskStop', task_id: 'b3' } as never)
    await endTurn('h1', 'answer', 'Result: page checked, server stopped.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
    expect((await shown()).slice(1, 3)).toEqual(['1 done One', '↳ page checked, server stopped.'])
  })

  test('/aside continue ends a step in the background and goes on, from any session', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')

    expect(await aside('continue')).toBe('Step 1 done; going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
    expect((await shown()).slice(1, 3)).toEqual(['1 done One', '↳ review started.'])
  })

  test('the person\'s own turns while a step is in the background are not the step\'s: they keep its result, and Esc in one keeps it there', async ($, on) => {
    const { sent, contexts, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')

    await type('what time is it')
    expect(contexts.at(-1)).toEqual([])
    await startTurn('what time is it', 'h1')
    await endTurn('h1', 'aborted', '')
    await type('and now')
    await startTurn('and now', 'h2')
    await endTurn('h2', 'answer', 'It is noon.')
    expect((await shown()).slice(1, 3)).toEqual(['1 running One', '↳ in the background: review'])
    await idle()
    expect(sent.filter(text => text.includes('(Step 2 of 3'))).toEqual([])
  })

  test('a notification delivered into a turn already running makes that turn the step\'s, told that it ends the step', async ($, on) => {
    const { sent, contexts, type, savePlan, aside, shown, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan([STEPS[0], STEPS[1]])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await endTurn('s1', 'answer', 'Result: one.')
    await idle()
    await startTurn(sent.at(-1)!, 's2')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s2', 'answer', 'Result: review started.')
    await type('what changed')
    await startTurn('what changed', 'h1')

    await $.prompt.submit({ text: notice('w1', 'toolu_1'), origin: { kind: 'task-notification' } as never, wait: false, turnId: 'h1' })
    expect(contexts.at(-1)).toEqual([
      '(Added by the aside plugin: this notification ends work in the background of step 2 of 2 of the queue plan, "Two". This was the last of it, so the step ends with your reply. It is the last step of this run: after the "Result: " line, end your reply with "## Summary of the run": one line per step of the plan on what was done, then what is still open, then what to do next. End your reply with one line that starts "Result: " and says in one sentence what the step has done and what is still open.)',
    ])
    await endTurn('h1', 'answer', 'Result: reviewed.\n\n## Summary of the run\n\nBoth done.')
    await idle()
    expect((await shown()).slice(1)).toEqual(['Plan done: 2 steps', '1 done One', '↳ one.', '2 done Two', '↳ reviewed.'])
  })

  test('a notification for work of no step, or into the step\'s own turn, adds nothing', async ($, on) => {
    const { sent, contexts, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await $.prompt.submit({ text: notice('w1', 'toolu_1'), origin: { kind: 'task-notification' } as never, wait: false, turnId: 's1' })
    expect(contexts.at(-1)).toEqual([])
    await $.tool.call({ tool: 'Workflow', script: 'y', tool_use_id: 'toolu_2' } as never)
    await endTurn('s1', 'answer', 'Result: started again.')
    await notify($, notice('other', 'toolu_other'))
    expect(contexts.at(-1)).toEqual([])
    expect((await shown())[2]).toBe('↳ in the background: review')
    await idle()
    expect(sent.filter(text => text.includes('(Step 2 of 3'))).toEqual([])
  })

  test('a notification matches its work by the call that started it, or by its task\'s id', async ($, on) => {
    const { contexts, aside, savePlan, startTurn, endTurn, idle, sent } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'find the docs', run_in_background: true, tool_use_id: 'toolu_a' } as never)
    await endTurn('s1', 'answer', 'Result: both started.')

    await notify($, notice('zz', 'toolu_1'))
    expect(contexts.at(-1)?.[0]).toContain('It still waits for: find the docs')
    await notify($, '<task-notification>\n<task-id>a7</task-id>\n<status>completed</status>\n</task-notification>')
    expect(contexts.at(-1)?.[0]).toContain('This was the last of it')
  })

  test('/aside plan asked during a step that goes on in the background organizes the queue once the step ends', async ($, on) => {
    const { sent, toasts, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')
    await idle()
    expect(sent).toHaveLength(1)

    await notify($, notice('w1', 'toolu_1'))
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await endTurn('n1', 'answer', 'Result: reviewed.')
    await idle()
    expect(toasts.at(-1)).toBe('Plan paused after step 1: to organize the queue. /aside continue goes on.')
    expect(sent.at(-1)).toContain('S1. One (done)')
  })

  test('the wait tool in the turn of a step in the background makes it wait for you', async ($, on) => {
    const { sent, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')
    await notify($, notice('w1', 'toolu_1'))
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await wait('which fix')
    await endTurn('n1', 'answer', 'Result: asks which fix.')

    expect((await shown()).slice(1, 3)).toEqual(['1 waiting One', '↳ asks which fix.'])
    expect(await aside('run 2')).toBe('Step 1 waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.')
  })

  test('work a call starts while the step waits, with no turn of it running, is not the step\'s', async ($, on) => {
    const { sent, type, savePlan, aside, shown, wait, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('x')
    await endTurn('s1', 'answer', 'Result: asks.')
    await $.tool.call({ tool: 'Bash', command: 'sleep 9', description: 'a wait', run_in_background: true, tool_use_id: 'toolu_b' } as never)
    await type('yes')
    await startTurn('yes', 'a1')
    await endTurn('a1', 'answer', 'Result: done.')
    await idle()
    expect((await shown()).slice(1, 3)).toEqual(['1 done One', '↳ done.'])
  })


  test('the turn of the notification cut short keeps the step, which then waits for continue', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')
    await notify($, notice('w1', 'toolu_1'))
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await endTurn('n1', 'aborted', '')

    expect(toasts.at(-1)).toBe('Step 1 waits for /aside continue, which ends it: its work in the background is done.')
    expect((await shown()).slice(1, 3)).toEqual(['1 running One', '↳ in the background'])
    expect(await aside('continue')).toBe('Step 1 done; going on with the plan from step 2. /aside stop stops after the current one.')
    await idle()
    expect((await shown()).slice(1, 3)).toEqual(['1 done One', '↳ review started.'])
  })
})

describe('a step whose turn never ends', () => {
  // The session `sessionId` ends; this one is session-1.
  const endSession = ($: Parameters<typeof world>[0], sessionId: string) => $.session.end({ reason: 'other', sessionId, resume: { id: sessionId } } as never)

  test('the next turn of the session leaves the step waiting, and /aside continue ends it and goes on', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, idle, band } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    // The session closed in the middle of s1 and was resumed: s1 never ends.
    await startTurn('is it done?', 'h1')
    expect(toasts.at(-1)).toBe("Step 1's turn never ended; it waits, and /aside continue ends it and goes on.")
    await endTurn('h1', 'answer', 'Yes.')
    await idle()
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▱▱▱ 0/3 · step 1 waits for you · ')
    await ui.unmount()

    expect((await shown()).slice(0, 2)).toEqual([
      'Plan waits at step 1 (its turn ended without an answer), 3 of 3 steps to do (/aside continue)',
      '1 waiting One',
    ])
    expect(await aside('continue')).toContain('step 2')
    await idle()
    expect(sent.at(-1)).toContain('(Step 2 of 3 of the queue plan, "Two", sent by the aside plugin.')
    expect((await shown())[1]).toBe('1 done One')
  })

  test('the end of its session leaves the step waiting, its work in the background let go, for any session to end', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle, band } = world($, on)
    launched(on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')
    await notify($, notice('w1', 'toolu_1'))
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await endSession($, 'session-1')
    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▱ 0/1 · step 1 waits for you · ')
    await ui.unmount()
    // An end heard after all changes nothing.
    await endTurn('n1', 'aborted')
    await idle()

    expect((await shown()).slice(0, 2)).toEqual([
      'Plan waits at step 1 (its turn ended without an answer), 1 of 1 step to do (/aside continue)',
      '1 waiting One',
    ])
    expect(await aside('stop')).toBe('Step 1 is done as it stands, and the plan stops there.')
  })

  test('a step that waits keeps what it waits for when the turn of its answer never ends', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, wait, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('needs a yes')
    await endTurn('s1', 'answer', 'Shall I?')
    await startTurn('yes', 'a1')
    await startTurn('and now?', 'h1')
    await endTurn('h1', 'answer', 'Now.')
    await idle()

    expect((await shown())[0]).toBe('Plan waits at step 1 (needs a yes), 3 of 3 steps to do (/aside continue)')
  })

  test('a step away keeps the work still going when the turn of a notification never ends', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'find the docs', run_in_background: true, tool_use_id: 'toolu_a' } as never)
    await endTurn('s1', 'answer', 'Result: started both.')
    await notify($, notice('w1', 'toolu_1'))
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await startTurn('meanwhile', 'h1')
    await endTurn('h1', 'answer', 'Sure.')
    await idle()

    expect((await shown()).slice(1, 3)).toEqual(['1 running One', '↳ in the background: find the docs'])
  })

  test('a step that /aside stop ended is done as it stands when the turn it left never ends', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, startTurn, endTurn, wait, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('needs a yes')
    await endTurn('s1', 'answer', 'Shall I?')
    await startTurn('yes', 'a1')
    expect(await aside('stop')).toBe('The plan stops after step 1.')
    await startTurn('later', 'h1')
    expect(toasts.filter(text => text.includes('never ended'))).toEqual([])
    await endTurn('h1', 'answer', 'Ok.')
    await idle()

    expect((await shown()).slice(-5, -2)).toEqual(['Plan: 2 of 3 steps to do (/aside run)', '1 done One', '↳ Shall I?'])
  })

  test('a turn of another process on the same session, and an end being handled as the next turn starts, are not dead', async ($, on) => {
    const { w, sent, aside, shown, savePlan, startTurn, endTurn, idle, fromAnotherSession } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    let release = () => {}
    w.turnEndHeld = new Promise<void>(resolve => (release = resolve))
    const ending = endTurn('s1', 'answer', 'Result: one done.')
    await startTurn('next', 'h1')
    release()
    await ending
    delete w.turnEndHeld
    await endTurn('h1', 'answer', 'Ok.')
    await idle()
    expect((await shown()).slice(1, 3)).toEqual(['Plan: 2 of 3 steps to do (/aside run)', '1 done One'])

    await fromAnotherSession('plan:/proj', { steps: STEPS, active: { step: 1, isChain: false, sessionId: 'session-1', turnId: 'elsewhere' } })
    await startTurn('here', 'h2')
    await endTurn('h2', 'answer', 'Ok.')
    await idle()
    expect((await shown())[0]).toBe('Plan: 3 of 3 steps to do (/aside run)')
    expect((await shown())[1]).toBe('1 to do One')
  })

  test('the end of its session lets go of a step away whose work started here, and leaves one whose work did not', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle, fromAnotherSession } = world($, on)
    launched(on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')
    await endSession($, 'session-1')
    await idle()
    expect((await shown())[0]).toBe('Plan waits at step 1 (its turn ended without an answer), 1 of 1 step to do (/aside continue)')

    const away = { step: 0, isChain: true, sessionId: 'session-1', isAway: true, background: [{ callId: 'toolu_9', taskId: 'w9', what: 'review' }] }
    await fromAnotherSession('plan:/proj', { steps: [STEPS[0]], active: away })
    await endSession($, 'session-1')
    expect((await shown())[1]).toBe('1 running One')
  })

  test('/aside plan asked while the step ran is dropped with its turn, and the toast says /aside plan organizes the queue', async ($, on) => {
    const { sent, toasts, type, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await startTurn('is it done?', 'h1')
    expect(toasts.at(-1)).toBe("Step 1's turn never ended; it waits, and /aside continue ends it and goes on; /aside plan organizes the queue.")
    const before = sent.length
    await endTurn('h1', 'answer', 'Yes.')
    await idle()
    expect(sent).toHaveLength(before)
  })

  test('a turn that ends as it should leaves the step to it, and a session that ends with none running changes nothing', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run')
    await idle()
    await startTurn(sent[0]!, 's1')
    await endSession($, 'another')
    await endTurn('s1', 'answer', 'Result: one done.')
    await idle()
    await endSession($, 'session-1')

    expect((await shown()).slice(0, 4)).toEqual(['The queue is empty.', 'Plan: 2 of 3 steps to do (/aside run)', '1 done One', '↳ one done.'])
  })

  test('a step that asked you something while its work ran in the background waits for your answer, not on that work', async ($, on) => {
    const { sent, toasts, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await endTurn('s1', 'answer', 'Result: review started.')
    await notify($, notice('w1', 'toolu_1'))
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await wait('which fix')
    // The turn it asked in never ends: the next one of this session finds it open, and the step
    // waits for the person, so that turn is the step's as it is for any step that waits.
    await startTurn('meanwhile', 'h1')
    expect(toasts.at(-1)).toBe("Step 1's turn never ended; it waits, and /aside continue ends it and goes on.")
    await endTurn('h1', 'answer', 'Ok.')
    await idle()

    expect(await aside('run 2')).toBe('Step 1 waits for your answer; /aside continue ends it and goes on, /aside stop ends it there.')
    expect((await shown()).slice(0, 2)).toEqual(['Plan waits at step 1 (which fix), 3 of 3 steps to do (/aside continue)', '1 waiting One'])
  })

  test('a step in the background that asked you nothing still goes on there when its turn never ends', async ($, on) => {
    const { sent, toasts, aside, savePlan, startTurn, endTurn, idle } = world($, on)
    launched(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Workflow', script: 'x', tool_use_id: 'toolu_1' } as never)
    await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'find the docs', run_in_background: true, tool_use_id: 'toolu_a' } as never)
    await endTurn('s1', 'answer', 'Result: started both.')
    await notify($, notice('w1', 'toolu_1'))
    await startTurn(notice('w1', 'toolu_1'), 'n1')
    await startTurn('meanwhile', 'h1')

    expect(toasts.filter(text => text.includes('never ended'))).toEqual([])
    expect(await aside('run 2')).toBe(
      'Step 1 goes on in the background (find the docs); /aside continue ends it and goes on, /aside stop ends it there.',
    )
  })
})
