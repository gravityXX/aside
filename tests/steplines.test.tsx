import { describe, expect, test } from 'claude-code/testing'

import { describeTool } from '../hooks/core/text'
import { STEPS, world } from './world'

describe('what the step running does now', () => {
  // The engine beneath runs the tools a test calls.
  const tools = (on: Parameters<typeof world>[1]) => on('tool.call', () => ({ result: { stdout: '' } as never }))

  test('the last tool of the step\'s own turn shows under it; a subagent\'s does not', async ($, on) => {
    const { sent, aside, savePlan, startTurn, idle, pane } = world($, on)
    tools(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'run the tests', tool_use_id: 't1' } as never)
    await $.tool.call({ tool: 'Read', file_path: '/proj/x.md', tool_use_id: 't2', agentId: 'a1' } as never)

    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /^↳ / }))?.text).toBe('↳ now: Bash, run the tests')
    await ui.unmount()
  })

  test('a step that waits shows no tool, though its turn called one', async ($, on) => {
    const { sent, aside, savePlan, startTurn, endTurn, wait, idle, pane } = world($, on)
    tools(on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await $.tool.call({ tool: 'Bash', command: 'bun test', tool_use_id: 't1' } as never)
    await wait('needs a yes')
    await endTurn('s1', 'answer', 'Shall I?')
    await idle()

    const ui = await pane()
    expect((await ui.find({ type: 'Text', text: /now:/ }))?.text).toBeUndefined()
    await ui.unmount()
  })

  test('a tool reads as its name and what this call of it is about', () => {
    expect(describeTool('Bash', { command: 'bun test --watch', description: 'run the tests' })).toBe('Bash, run the tests')
    expect(describeTool('Bash', { command: 'bun test --watch' })).toBe('Bash, bun test --watch')
    expect(describeTool('Edit', { file_path: '/home/x/repo/hooks/features/plan.ts' })).toBe('Edit, plan.ts')
    expect(describeTool('Workflow', { script: "export const meta = { name: 'review-dead-turn', description: 'x' }" })).toBe('Workflow, review-dead-turn')
    expect(describeTool('Grep', { pattern: 'isWaiting' })).toBe('Grep, isWaiting')
    expect(describeTool('mcp__aside__plan', { steps: [] })).toBe('aside plan')
    expect(describeTool('Bash', { command: 'x'.repeat(80) })).toHaveLength(60)
  })
})

describe('a step stopped as it stood', () => {
  test('says it was stopped when it said nothing it did', async ($, on) => {
    const { aside, shown, fromAnotherSession } = world($, on)
    await fromAnotherSession('plan:/proj', { steps: STEPS, active: { step: 0, isChain: true, sessionId: 'session-1', turnId: 'before-resume' } })
    await aside('stop')

    expect((await shown()).slice(2, 4)).toEqual(['1 done One', '↳ stopped'])
  })

  test('keeps what it said when it said something', async ($, on) => {
    const { sent, aside, shown, savePlan, startTurn, endTurn, wait, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await startTurn(sent[0]!, 's1')
    await wait('needs a yes')
    await endTurn('s1', 'answer', 'Shall I?')
    await idle()
    await aside('stop')

    expect((await shown()).slice(2, 4)).toEqual(['1 done One', '↳ Shall I?'])
  })
})

describe('a step an earlier release titled with its text cut short', () => {
  const TEXT = 'teraz dostałem wiadomość, że praca / zadanie zostało skończone, a review w tle nadal działa'
  const OLD = { title: `${TEXT.slice(0, 49).trimEnd()}…`, prompt: `${TEXT} (while you worked on "continue", branch main)` }

  test('is named by the small model once, from the idea\'s text alone, when /aside shows it', async ($, on) => {
    const { w, asked, aside, idle, fromAnotherSession } = world($, on, { tidy: {} })
    w.titleReply = '<title>Review w tle a koniec planu</title>'
    await fromAnotherSession('plan:/proj', { steps: [{ ...OLD, isDone: true }, { title: 'Two', prompt: 'Do two.' }] })
    await aside()
    await idle()

    expect(asked).toEqual([`<note>\n${TEXT}\n</note>`])
    expect(await aside()).toContain('Review w tle a koniec planu')
    await idle()
    expect(asked).toHaveLength(1)
  })

  test('a title the model gives no answer for is asked for no more in this process', async ($, on) => {
    const { asked, aside, idle, fromAnotherSession } = world($, on, { tidy: {} })
    await fromAnotherSession('plan:/proj', { steps: [OLD] })
    await aside()
    await idle()
    await aside()
    await idle()

    expect(asked).toHaveLength(1)
  })

  test('a title that does not start the prompt, or with tidy off, is left as it is', async ($, on) => {
    const { asked, aside, idle, fromAnotherSession } = world($, on, { tidy: {} })
    await fromAnotherSession('plan:/proj', { steps: [{ title: OLD.title, prompt: `Question - In docs/report.md:\n${TEXT}` }] })
    await aside()
    await idle()

    expect(asked).toEqual([])
  })

  test('with tidy off, no model is asked', { options: { tidy: 'off' } }, async ($, on) => {
    const { asked, aside, idle, fromAnotherSession } = world($, on)
    await fromAnotherSession('plan:/proj', { steps: [OLD] })
    await aside()
    await idle()

    expect(asked).toEqual([])
  })
})
