import { describe, expect, test } from 'claude-code/testing'

import { REPORT, REPORT_PATH, STEPS, world } from './world'

describe('the band above the prompt', () => {
  test('the band shows what waits, keeps the list button, and offers the next move for the plan', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, idle, band } = world($, on)
    on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
      const { Text } = $e.ui.resolve(e)
      return <Text>engine</Text>
    })
    const read = async () => {
      const ui = await band()
      const text = (await ui.find({ type: 'Text', text: /^aside: |engine/ }))?.text
      const list = (await ui.find({ key: 'list' }))?.props.label
      const action = (await ui.find({ key: 'action' }))?.props.label
      await ui.unmount()
      return [text, list, action]
    }

    expect(await read()).toEqual(['engine', undefined, undefined])
    await type('+ x\n+? y')
    expect(await read()).toEqual(['aside: 1 idea, 1 comment · ', 'list', undefined])
    await aside('plan')
    await savePlan(STEPS)
    expect(await read()).toEqual(['aside: plan ▱▱▱ 0/3 · ', 'list', 'run plan'])
    await aside('run all')
    await idle()
    await startTurn(sent.at(-1)!, 's1')
    expect(await read()).toEqual(['aside: plan ▱▱▱ 0/3 · step 1 running · ', 'list', 'stop'])
  })

  test('the band keeps its text and both buttons on one line, the plan running or not', async ($, on) => {
    const { sent, savePlan, aside, startTurn, idle, band } = world($, on)
    const row = async () => {
      const ui = await band()
      // A drawn element carries no props when it was given none.
      type Drawn = { type: string; props?: { key?: string; flexDirection?: string }; children: Drawn[] }
      const drawn = (await ui.drawn()) as Drawn
      await ui.unmount()

      return { direction: drawn.props?.flexDirection ?? 'row', children: drawn.children.map(child => child.props?.key ?? child.type) }
    }
    await savePlan(STEPS)
    expect(await row()).toEqual({ direction: 'row', children: ['Text', 'list', 'Text', 'action'] })
    await aside('run all')
    await idle()
    await startTurn(sent.at(-1)!, 's1')
    expect(await row()).toEqual({ direction: 'row', children: ['Text', 'list', 'Text', 'action'] })
  })

  test('a step that waits for the person shows on the band, and its continue button ends it and goes on with the run', async ($, on) => {
    const { sent, toasts, aside, savePlan, startTurn, endTurn, idle, band, pressBand } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'mcp__aside__wait', reason: 'x' } as never)
    await endTurn('s1')

    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▱▱▱ 0/3 · step 1 waits for you · ')
    expect((await ui.find({ key: 'action' }))?.props.label).toBe('continue')
    await ui.unmount()
    await pressBand('action')
    expect(toasts.at(-1)).toBe('Step 1 done; going on with the plan from step 2. /aside stop stops after the current one.')
    expect(sent.at(-1)).toContain('Do two.')
    const after = await band()
    expect((await after.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▰▱▱ 1/3 · step 2 running · ')
    expect((await after.find({ key: 'action' }))?.props.label).toBe('stop')
    await after.unmount()
  })

  test('a run paused after a step shows on the band, and its continue button goes on with it', async ($, on) => {
    const { sent, toasts, type, aside, savePlan, startTurn, endTurn, idle, band, pressBand } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await type('+ dark mode', 's1')
    await aside('plan')
    await endTurn('s1')
    await idle()

    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▰▱▱ 1/3 · paused after step 1 · ')
    expect((await ui.find({ key: 'action' }))?.props.label).toBe('continue')
    await ui.unmount()
    await pressBand('action')
    expect(toasts.at(-1)).toBe('Going on with the plan from step 2. /aside stop stops after the current one.')
    expect(sent.at(-1)).toContain('Do two.')
  })

  test('when the store refuses the run, the band\'s button says why in a toast', async ($, on) => {
    const { w, toasts, savePlan, pressBand } = world($, on)
    await savePlan(STEPS)
    w.isStoreFull = true

    await pressBand('action')
    expect(toasts.at(-1)).toBe('Could not run the plan (the store is full).')
  })

  test('its list button opens the list pane, and closes it on a second press', async ($, on) => {
    const { panes, type, pressBand } = world($, on)
    await type('+ x')

    await pressBand()
    expect(panes).toEqual(['aside'])
    await pressBand()
    expect(panes).toEqual([])
  })

  test('its list button brings the pane back when it is open out of sight, rather than closing it', async ($, on) => {
    const { w, panes, toasts, type, pressBand } = world($, on)
    await type('+ x')
    await pressBand()
    w.isPaneHidden = true

    await pressBand()
    expect(panes).toEqual(['aside'])
    expect(toasts).toEqual([])
  })

  test('when the terminal cannot seat the pane, its list button says why', async ($, on) => {
    const { panes, toasts, type, pressBand } = world($, on, { isNarrow: true })
    await type('+ x')

    await pressBand()
    expect(panes).toEqual([])
    expect(toasts).toEqual(['Could not show the list pane (the terminal is too narrow); /aside shows the list'])
  })

  test('its run plan and stop buttons run and stop the plan by themselves', async ($, on) => {
    const { sent, toasts, savePlan, startTurn, pressBand } = world($, on)
    await savePlan(STEPS)

    await pressBand('action')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('(Step 1 of 3 of the queue plan, "One", sent by the aside plugin.')
    await startTurn(sent[0]!, 's1')
    await pressBand('action')
    expect(toasts).toEqual(['Running the plan: 3 steps, from step 1. /aside stop stops after the current one.', 'The plan stops after step 1.'])
  })
})

describe('the list pane', () => {
  test('the pane lists the queue in colour, and its plan button organizes it', async ($, on) => {
    const { sent, panes, type, pressBand, pane, idle } = world($, on)
    await type('+ x\n+? y')
    await pressBand()

    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /^x$/ }))?.text).toBe('x')
    expect((await ui.find({ type: 'Text', text: /^question$/ }))?.props.color).toBe('warning')
    await ui.press({ key: 'plan' })
    await ui.unmount()
    await idle()
    expect(panes).toEqual([])
    expect(sent.at(-1)).toContain('Organize all of it, and only organize it')
  })

  test('when the store refuses the hand-over, the plan button says why and the pane closes after', async ($, on) => {
    const { w, sent, toasts, panes, type, pressBand, pane, idle } = world($, on)
    await type('+ x')
    await pressBand()
    w.isStoreFull = true

    const ui = await pane()
    await ui.press({ key: 'plan' })
    await ui.unmount()
    await idle()
    expect(toasts.at(-1)).toBe('Could not organize the queue (the store is full).')
    expect(panes).toEqual([])
    expect(sent).toEqual([])
  })

  test('while a step runs, the pane lists the queue and still offers its plan button', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, pressBand, pane, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent.at(-1)!, 's1')
    await type('+ x', 's1')
    await pressBand()

    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /^x$/ }))?.text).toBe('x')
    expect((await ui.find({ type: 'Text', text: /^running$/ }))?.props.color).toBe('warning')
    expect(await ui.find({ key: 'plan' })).toBeDefined()
    await ui.unmount()
  })

  test('the pane says so when the queue is empty, and closes on its button', async ($, on) => {
    const { panes, type, aside, pressBand, pane } = world($, on)
    await type('+ x')
    await pressBand()
    await aside('clear')

    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /queue is empty/ }))?.text).toBe('The queue is empty.')
    expect(await ui.find({ key: 'plan' })).toBeUndefined()
    await ui.press({ key: 'close' })
    await ui.unmount()
    expect(panes).toEqual([])
  })
})

describe('the /aside output', () => {
  test('the list /aside printed is drawn in a frame, each kind in its colour', async ($, on) => {
    const { write, type, aside, output } = world($, on, { files: { [REPORT_PATH]: REPORT }, clip: 'Revenue grew by 12% in the third quarter' })
    await write(REPORT_PATH)
    await type('+ alpha')
    await type('+? where from')

    const ui = await output(await aside())
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    expect((await ui.find({ type: 'Text', text: '1 idea and 1 comment waiting' }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^question$/ }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: /^idea$/ }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: /^↳ docs\/report\.md:5 · "Revenue/ }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: 'Tags in files' }))?.props.bold).toBe(true)
    await ui.unmount()
  })

  test('any other output, from /aside or another command, is drawn as the engine draws it', async ($, on) => {
    // The engine's own drawing, which the test kit does not make.
    on('ui.render', { component: 'CommandOutput' }, () => ({ type: 'Text', props: {}, children: ['as printed'] }) as never)
    const { output } = world($, on)
    const listing = '1 idea waiting\n\n  1  idea  a'

    for (const [text, command] of [['Removed: alpha', 'aside'], ['The queue is empty.', 'aside'], [listing, 'cost']] as const) {
      const ui = await output(text, command)
      expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['as printed'] })
      await ui.unmount()
    }
    const ui = await output(`aside: ${listing}`)
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    await ui.unmount()
  })
})

describe('the plan tool in the transcript', () => {
  const row = (output: unknown, more: object = {}) => ({
    tool_use_id: 'u1',
    tool: 'mcp__aside__plan',
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
    output,
    ...more,
  })

  test('the row of a saved plan is drawn in the frame /aside draws, and nothing is printed under it', async ($, on) => {
    const { sent, type, aside, savePlan, startTurn, idle, mount } = world($, on)
    await type('+ a\n+ b')
    await aside('plan')
    await idle()
    await startTurn(sent.at(-1)!, 'p1')
    const { result } = await savePlan([{ title: 'A', prompt: 'Do a.' }], [{ item: 2, question: 'What is b for?' }])

    const ui = await mount('ToolUse', row(result))
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
    expect((await ui.find({ type: 'Text', text: 'Plan: 1 of 1 step to do (/aside run)' }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: '○' }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^idea$/ }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: '↳ What is b for?' }))?.props.dimColor).toBe(true)
    await ui.unmount()

    const under = await mount('ToolResult', { tool_use_id: 'u1', tool: 'mcp__aside__plan', output: result, isErrored: false })
    expect(await under.drawn()).toMatchObject({ type: 'Box' })
    expect(await under.find({ type: 'Text' })).toBeUndefined()
    await under.unmount()
  })

  test('a plan tool call that runs or was refused, and any other tool, is drawn as the engine draws it', async ($, on) => {
    // The engine's own drawing, which the test kit does not make.
    on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text', props: {}, children: ['as drawn'] }) as never)
    on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Text', props: {}, children: ['as drawn'] }) as never)
    const { savePlan, mount } = world($, on)
    const { result } = await savePlan([{ title: 'A', prompt: 'Do a.' }])

    for (const props of [
      row(undefined, { isRunning: true }),
      row('steps must be a non-empty list', { isErrored: true }),
      row(result, { isInterrupted: true }),
      row(result, { tool: 'Bash' }),
      row('Saved 3 steps. Tell the user: /aside run all runs them all in order.'),
    ]) {
      const ui = await mount('ToolUse', props)
      expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['as drawn'] })
      await ui.unmount()
    }
    const under = await mount('ToolResult', { tool_use_id: 'u1', tool: 'Bash', output: result, isErrored: false })
    expect(await under.drawn()).toMatchObject({ type: 'Text', children: ['as drawn'] })
    await under.unmount()
  })
})

describe('where aside draws', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`on ${surface}, the band, the list pane, the /aside frame and the plan tool's row are drawn by aside`, async ($, on) => {
      const { type, aside, savePlan, mount } = world($, on)
      await type('+ x')
      const { result } = await savePlan(STEPS)

      const band = await mount('AbovePrompt', { hasSurvey: false, isWorking: false }, surface)
      expect(await band.find({ key: 'list' })).toBeDefined()
      await band.unmount()
      const pane = await mount('Pane', { title: 'aside', isFocused: true, bodyColumns: 100, placement: 'dock' }, surface)
      expect((await pane.find({ type: 'Text', text: /^x$/ }))?.text).toBe('x')
      await pane.unmount()
      const frame = await mount('CommandOutput', { command: 'aside', args: '', text: await aside(), isErrored: false }, surface)
      expect(await frame.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
      await frame.unmount()
      const row = await mount('ToolUse', { tool_use_id: 'u1', tool: 'mcp__aside__plan', input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: result }, surface)
      expect(await row.drawn()).toMatchObject({ type: 'Box', props: { borderStyle: 'round' } })
      await row.unmount()
    })
  }

  for (const surface of ['vscode', 'mobile'] as const) {
    test(`on ${surface}, the engine draws its own`, async ($, on) => {
      // The engine's own drawing, which the test kit does not make.
      on('ui.render', { component: 'Pane' }, () => ({ type: 'Text', props: {}, children: ['as drawn'] }) as never)
      const { type, mount } = world($, on)
      await type('+ x')

      const pane = await mount('Pane', { title: 'aside', isFocused: true, bodyColumns: 100, placement: 'dock' }, surface)
      expect(await pane.drawn()).toMatchObject({ type: 'Text', children: ['as drawn'] })
      await pane.unmount()
    })
  }
})

describe('the plan drawn as a line of steps', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`on ${surface}, each step has its mark in its state's colour, what it took under it, and a double line where it paused`, async ($, on) => {
      const { sent, type, aside, savePlan, startTurn, endTurn, answer, idle, mount } = world($, on)
      await savePlan([...STEPS, { title: 'Four', prompt: 'Do four.' }])
      await aside('run all')
      await idle()
      await answer('s1', 'Result: one is in place.', 8 * 60_000)
      await startTurn(sent.at(-1)!, 's2')
      await type('+ dark mode', 's2')
      await aside('plan')
      await endTurn('s2', 'answer', '', 5 * 60_000)
      await idle()

      const ui = await mount('CommandOutput', { command: 'aside', args: '', text: await aside(), isErrored: false }, surface)
      expect((await ui.find({ type: 'Text', text: /^Plan paused after step 2/ }))?.text).toBe(
        'Plan paused after step 2 (to organize the queue), 2 of 4 steps to do (/aside continue) · 13 min so far',
      )
      expect((await ui.find({ type: 'Text', text: '●' }))?.props.color).toBe('success')
      expect((await ui.find({ type: 'Text', text: '○' }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: '↳ 8 min · one is in place.' }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: '║' }))?.text).toBe('║')
      expect((await ui.find({ type: 'Text', text: 'paused here: /aside continue' }))?.text).toBe('paused here: /aside continue')
      await ui.unmount()
    })

    test(`on ${surface}, the step that waits for the person has a mark of its own, what it said so far under it, and a double line`, async ($, on) => {
      const { sent, aside, savePlan, startTurn, endTurn, answer, wait, idle, mount } = world($, on)
      await savePlan([...STEPS, { title: 'Four', prompt: 'Do four.' }])
      await aside('run all')
      await idle()
      await answer('s1', 'Result: one is in place.', 8 * 60_000)
      await startTurn(sent.at(-1)!, 's2')
      await wait('needs your yes')
      await endTurn('s2', 'answer', 'Result: two asks first.', 5 * 60_000)

      const ui = await mount('CommandOutput', { command: 'aside', args: '', text: await aside(), isErrored: false }, surface)
      expect((await ui.find({ type: 'Text', text: /^Plan waits at step 2/ }))?.text).toBe(
        'Plan waits at step 2 (needs your yes), 3 of 4 steps to do (/aside continue) · 13 min so far',
      )
      expect((await ui.find({ type: 'Text', text: '◉' }))?.props.color).toBe('suggestion')
      expect((await ui.find({ type: 'Text', text: 'waiting' }))?.props.color).toBe('suggestion')
      expect((await ui.find({ type: 'Text', text: '↳ 5 min · two asks first.' }))?.props.dimColor).toBe(true)
      expect((await ui.find({ type: 'Text', text: '║' }))?.text).toBe('║')
      expect((await ui.find({ type: 'Text', text: 'waits for you here: /aside continue ends it' }))?.text).toBe('waits for you here: /aside continue ends it')
      await ui.unmount()
    })
  }

  test('the band shows a long plan in ten marks at most', async ($, on) => {
    const { savePlan, band } = world($, on)
    await savePlan(Array.from({ length: 12 }, (_, i) => ({ title: `Step ${i + 1}`, prompt: `Do ${i + 1}.` })))

    const ui = await band()
    expect((await ui.find({ type: 'Text', text: /^aside: / }))?.text).toBe('aside: plan ▱▱▱▱▱▱▱▱▱▱ 0/12 · ')
    await ui.unmount()
  })
})
