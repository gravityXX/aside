import { describe, expect, test } from 'claude-code/testing'

import { asks, last, REPORT, REPORT_PATH, STEPS, world } from './world'

// /aside plan on a model of its own: one call outside the conversation organizes the queue.

describe('planning on a model of its own', () => {
  const SONNET = { options: { planModel: 'sonnet' } }
  const PLAN = '```json\n{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}], "unclear": [{"item": 2, "question": "Which login bug?"}]}\n```'

  test('a plan organized while Claude works shows in the pane, whatever list the pane showed before', SONNET, async ($, on) => {
    const { w, type, aside, startTurn, pane } = world($, on)
    await type('+ dark mode\n+g far one')
    await startTurn('build the parser', 't1')
    await aside('g')
    const ui = await pane()
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'

    await aside('plan')
    expect((await ui.find({ type: 'Text', text: /^Plan: / }))?.text).toBe('Plan: 1 of 1 step to do (/aside run)')
    expect(await ui.find({ type: 'Text', text: 'far one' })).toBeUndefined()
    await ui.unmount()
  })

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

  test('steps the planner adds while the last step sums the run up wait for /aside run, as the summary said the run ended', SONNET, async ($, on) => {
    const { w, sent, toasts, type, aside, shown, savePlan, wait, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await answer('s1')
    await answer('s2')
    await startTurn(sent.at(-1)!, 's3')
    await wait('which name')
    await endTurn('s3')
    await aside('continue')
    await idle()
    await startTurn(sent.at(-1)!, 'c1')
    await type('+ dark mode', 'c1')
    w.planReply = DARK
    await aside('plan')

    await endTurn('c1', 'answer', 'Result: summed up.')
    await idle()
    expect(toasts.at(-1)).toBe('Step 3 done')
    expect(sent.at(-1)).toContain('I pressed continue, so this step ends here')
    expect((await shown()).slice(1)).toEqual(['Plan: 1 of 4 steps to do (/aside run)', '1 done One', '2 done Two', '3 done Three', '↳ summed up.', '4 to do Dark mode'])
  })

  test('while a step runs, the planner adds its steps after the plan\'s own at once, and the run goes on to them', SONNET, async ($, on) => {
    const { w, sent, planned, panes, type, aside, shown, savePlan, startTurn, endTurn, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
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
    expect((await shown()).at(-1)).toBe('The queue is empty.')
    await answer('s2')
    await answer('s3')
    expect(sent.at(-1)).toContain('Add a dark mode.\n\n(Step 4 of 4 of the queue plan, "Dark mode"')
  })

  test('a step that ends while the planner thinks, and the next that starts, change nothing it was given', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
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
    await aside('run all')
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
    expect((await shown()).slice(0, -1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 running Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('a step that ends just as the planner saves keeps both: the step done and the steps added', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
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
    expect((await shown()).slice(0, -1)).toEqual(['Plan: 3 of 4 steps to do (/aside run)', '1 done One', '2 running Two', '3 to do Three', '4 to do Dark mode'])
  })

  test('a step that starts to wait, a stop or an interruption while the planner thinks keeps the steps it adds', SONNET, async ($, on) => {
    const { w, sent, type, aside, shown, savePlan, wait, startTurn, endTurn, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
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
    expect((await shown()).slice(0, -1)).toEqual([
      'Plan waits at step 1 (which colours), 4 of 4 steps to do (/aside continue)',
      '1 waiting One',
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
    await aside('run all')
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
      await aside('run all')
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
    await aside('run all')
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
    expect(await shown()).toEqual(['Plan: 1 of 1 step to do (/aside run)', '1 running dark mode', 'The queue is empty.'])
  })

  test('an entry removed while the planner thinks and typed again alike makes it save nothing, the new one being another entry', SONNET, async ($, on) => {
    const { w, type, aside, shown } = world($, on)
    await type('+ dark mode')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}]}'
    w.meanwhile = async () => {
      w.meanwhile = undefined
      await aside('remove 1')
      await type('+ dark mode')
    }

    expect(await aside('plan')).toBe('The queue or the plan changed while Sonnet planned; nothing was saved. /aside plan tries again.')
    expect(await shown()).toEqual(['1 idea waiting', '1 idea dark mode'])
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
      await aside('run all')
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

  test('a tidy reply that comes while a new entry is being stored is in the queue before the planner reads it', SONNET, async ($, on) => {
    const { w, planned, clock, type, enter, aside, shown } = world($, on, { tidy: { 'dark mod': '<note>Dark mode.</note>' } })
    let release = () => {}
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    // The tidying of the first entry waits to be let go; every model call after it, the
    // planner's among them, takes a moment.
    w.meanwhile = async () => {
      w.meanwhile = () => clock.sleep(1)
      await held
    }
    await type('+ dark mod')
    w.planReply = '{"steps": [{"title": "Dark mode", "prompt": "Add a dark mode."}, {"title": "Login", "prompt": "Fix the login bug."}]}'
    // The tidy reply comes while the second entry is on its way to the store.
    w.beforeWrite = async key => {
      if (!key.startsWith('queue:')) return
      w.beforeWrite = undefined
      release()
      await clock.sleep(1)
    }

    await enter('+ fix the login bug')
    const planning = aside('plan')
    await clock.advance(5)
    expect(await planning).toBe(['Plan: 2 of 2 steps to do (/aside run)', '', '  1  to do  Dark mode', '  2  to do  Login'].join('\n'))
    expect(planned[0]!.prompt).toContain('1. Dark mode.')
    expect((await shown()).slice(0, 1)).toEqual(['The queue is empty.'])
  })

  test('an entry back from /aside edit is planned as tidied when the planner starts as the edit is forgotten', SONNET, async ($, on) => {
    const { w, planned, clock, type, enter, aside } = world($, on)
    await type('+ login bug')
    await aside('edit 1')
    w.tidy = { 'fix the login bug': '<note>Fix the login bug.</note>' }
    w.planReply = '{"steps": [{"title": "Login", "prompt": "Fix the login bug."}]}'
    w.meanwhile = () => clock.sleep(1)
    // The reworked entry is stored, and the planner is asked while the edit is on its way out.
    let planning = Promise.resolve('')
    w.beforeDelete = async key => {
      if (!key.startsWith('editing:')) return
      w.beforeDelete = undefined
      planning = aside('plan')
      await clock.sleep(1)
    }

    await enter('+ fix the login bug')
    await clock.advance(5)
    expect(await planning).toBe(['Plan: 1 of 1 step to do (/aside run)', '', '  1  to do  Login'].join('\n'))
    expect(planned[0]!.prompt).toContain('1. Fix the login bug.')
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
