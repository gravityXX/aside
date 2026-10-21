import { describe, expect, test } from 'claude-code/testing'

import { last, STEPS, world } from './world'

// The log of plans run to their end, as /aside log shows them.

describe('the log of plans run to their end', () => {
  test('a plan run to its end goes to the log once another takes its place, with each step\'s time and result', async ($, on) => {
    const { clock, aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.', 60_000)
    await answer('s2', 'Result: two.', 60_000)
    // The run ended when its last step did.
    await clock.advance(2 * 3_600_000)
    await answer('s3', 'Result: three.', 60_000)
    expect(await aside('log')).toBe('The log is empty: a plan run to its end comes here once another takes its place. /aside shows the plan now.')

    await clock.advance(3 * 3_600_000)
    await savePlan([{ title: 'Four', prompt: 'Do four.' }])
    expect(await shown('log')).toEqual(['Run 1, 3 h ago: 3 steps in 3 min', '1 done One', '↳ 1 min · one.', '2 done Two', '↳ 1 min · two.', '3 done Three', '↳ 1 min · three.'])
    expect((await shown()).slice(1)).toEqual(['Plan: 1 of 1 step to do (/aside run)', '1 to do Four'])
    expect(await aside('log 2')).toBe('Give a number from 1 to 1, as /aside log shows them.')
  })

  test('a plan merged with new steps keeps its steps done, and goes to the log only once it has run to its end', async ($, on) => {
    const { aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan(STEPS)
    await aside('run 1')
    await idle()
    await answer('s1', 'Result: one.')
    await savePlan([{ title: 'Four', prompt: 'Do four.' }])
    expect(await aside('log')).toBe('The log is empty: a plan run to its end comes here once another takes its place. /aside shows the plan now.')

    await aside('run all')
    await idle()
    await answer('s4', 'Result: four.')
    await savePlan([{ title: 'Five', prompt: 'Do five.' }])
    expect((await shown('log')).slice(1)).toEqual(['1 done One', '↳ one.', '2 done Four', '↳ four.'])
  })

  test('running the queue entry by entry after a plan run to its end puts that plan in the log', async ($, on) => {
    const { type, aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.')
    await type('+ a')

    expect(await aside('run all')).toBe('Running 1 entry one by one. /aside stop stops after the current one.')
    expect((await shown('log')).slice(1)).toEqual(['1 done One', '↳ one.'])
  })

  test('running chosen entries after a plan run to its end puts that plan in the log, and a plan another session starts meanwhile stays', async ($, on) => {
    const { w, type, aside, shown, savePlan, answer, idle, fromAnotherSession } = world($, on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.')
    await type('+ a\n+ b')

    expect(await aside('run 2')).toBe('Running entry 2: b')
    expect((await shown('log')).slice(1)).toEqual(['1 done One', '↳ one.'])
    await idle()
    await answer('e1')
    // Another session saves a plan with a step still to do as this one takes the queue, in
    // place of the plan of entry b: that plan stays, and the entry goes back to the queue.
    w.beforeWrite = async key => {
      if (!key.startsWith('taken')) return
      w.beforeWrite = undefined
      await fromAnotherSession('plan:/proj', { steps: [{ ...STEPS[1], isDone: true, ms: 0 }, STEPS[2]] })
    }
    expect(await aside('run all')).toBe('Another session started a plan meanwhile; the entries stay in the queue, and /aside shows the plan.')
    expect((await shown('log')).filter(line => /^\d done/.test(line))).toEqual(['1 done One'])
    expect((await shown())[0]).toBe('1 idea waiting')
  })

  test('each run in the log is under the number /aside log N takes, with how long ago it ended', async ($, on) => {
    const { clock, aside, shown, savePlan, answer, idle } = world($, on)
    expect(await aside('log')).toBe('The log is empty: a plan run to its end comes here once another takes its place.')
    const waits = [47 * 3_600_000, 25 * 3_600_000 - 5 * 60_000, 5 * 60_000]
    for (let k = 1; k <= 3; k += 1) {
      await savePlan([{ title: `P${k}`, prompt: `Do ${k}.` }])
      await aside('run all')
      await idle()
      await answer(`s${k}`)
      await clock.advance(waits[k - 1]!)
    }
    await savePlan([{ title: 'P4', prompt: 'Do 4.' }])

    expect(await shown('log')).toEqual(['Run 1, 5 min ago: 1 step', '1 done P3', 'Run 2, 1 day ago: 1 step', '1 done P2', 'Run 3, 3 days ago: 1 step', '1 done P1'])
    expect(await shown('log 2')).toEqual(['Run 2, 1 day ago: 1 step', '1 done P2'])
  })

  test('a plan saved by an earlier release, its steps done with no time kept, goes to the log once, aged from when it went there', async ($, on) => {
    const stored = { 'plan:/proj': { steps: [{ title: 'Old', prompt: 'Do old.', isDone: true, ms: 60_000, result: 'old.' }] } }
    const { w, clock, aside, shown, savePlan } = world($, on, { stored })
    w.refuseWriteTo = 'plan:'

    expect((await savePlan([{ title: 'New', prompt: 'Do new.' }])).deny).toBe('aside could not save the plan (the store is full); the plan was not saved, so call the tool again')
    await clock.advance(5 * 60_000)
    await savePlan([{ title: 'New', prompt: 'Do new.' }])
    expect(await shown('log')).toEqual(['Run 1, just now: 1 step in 1 min', '1 done Old', '↳ 1 min · old.'])
    expect(await aside('log 2')).toBe('Give a number from 1 to 1, as /aside log shows them.')
  })

  test('the log keeps the last 20 plans and shows 5, the newest first; /aside log N shows an older one', async ($, on) => {
    const { clock, aside, shown, savePlan, answer, idle } = world($, on)
    for (let k = 1; k <= 22; k += 1) {
      await savePlan([{ title: `P${k}`, prompt: `Do ${k}.` }])
      await aside('run all')
      await idle()
      await answer(`s${k}`)
      await clock.advance(60_000)
    }

    const log = await shown('log')
    expect(log.filter(line => line.startsWith('1 done'))).toEqual(['1 done P21', '1 done P20', '1 done P19', '1 done P18', '1 done P17'])
    expect(log.at(-1)).toBe('15 older in the log: /aside log 6 shows the next.')
    expect((await shown('log 20')).slice(1)).toEqual(['1 done P2'])
    expect(await aside('log 21')).toBe('Give a number from 1 to 20, as /aside log shows them.')
  })

  test('a plan saved again after its log entry failed half-way is in the log once', async ($, on) => {
    const { w, aside, shown, savePlan, answer, idle } = world($, on)
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.')
    // The plan's own write fails, after its log entry was written.
    w.refuseWriteTo = 'plan:'

    expect((await savePlan([{ title: 'Two', prompt: 'Do two.' }])).deny).toBe('aside could not save the plan (the store is full); the plan was not saved, so call the tool again')
    expect((await shown()).slice(1)).toEqual(['Plan done: 1 step', '1 done One', '↳ one.'])
    await savePlan([{ title: 'Two', prompt: 'Do two.' }])
    expect(await shown('log')).toEqual(['Run 1, just now: 1 step', '1 done One', '↳ one.'])
  })

  test('while Claude works on a narrow terminal, /aside log goes into the transcript at once', async ($, on) => {
    const { logged, aside, savePlan, answer, startTurn, idle } = world($, on, { isNarrow: true })
    await savePlan([STEPS[0]])
    await aside('run all')
    await idle()
    await answer('s1', 'Result: one.')
    await savePlan([{ title: 'Two', prompt: 'Do two.' }])
    await startTurn('build it', 't1')

    expect(await aside('log')).toBe('Wrote the log above while Claude was working.')
    expect(logged.at(-1)).toBe(['Run 1, just now: 1 step', '', '  1  done  One', '           ↳ one.'].join('\n'))
  })
})

