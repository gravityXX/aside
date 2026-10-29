import { describe, expect, test } from 'claude-code/testing'

import type { Plan, Step } from '../types'
import { decide } from '../hooks/core/reduce'
import { stepState } from '../hooks/core/step'

// What each event does to the plan, checked on the plan itself rather than through a session.
// These are the moves of one closed graph with many cases, so they are a table here (6.3); what
// the person and Claude read of them is in plan.test.tsx and steps.test.tsx.

const STEPS: Step[] = [
  { title: 'One', prompt: 'do one' },
  { title: 'Two', prompt: 'do two' },
]
const ME = 'session-1'
const run = { step: 0, isChain: true, sessionId: ME }
const planOf = (active?: Plan['active'], steps: Step[] = STEPS): Plan => ({ steps: [...steps], ...(active ? { active } : {}) })

describe('the wait tool asking the person something', () => {
  test('a step whose turn is running starts waiting for the answer, and says so', () => {
    const plan = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const made = decide(plan, { is: 'ask', sessionId: ME, pausedFor: 'which design' })

    expect(made.outcome).toBe('waits')
    expect(made.plan.active).toEqual(stepState({ ...run, is: 'asking', turnId: 't1', pausedFor: 'which design' }))
    expect(made.does).toEqual([])
    // The plan it was given is left alone: the move answers with a new one (4.7).
    expect(plan.active?.is).toBe('running')
  })

  test('the last step of a run of several says so, so Claude writes no summary yet', () => {
    const plan = planOf(stepState({ step: 1, isChain: true, sessionId: ME, is: 'running', turnId: 't1' }))

    expect(decide(plan, { is: 'ask', sessionId: ME, pausedFor: 'which' }).outcome).toBe('last')
  })

  test('a step run alone is never the last of a run, however many steps the plan has', () => {
    const plan = planOf(stepState({ step: 1, isChain: false, sessionId: ME, is: 'running', turnId: 't1' }))

    expect(decide(plan, { is: 'ask', sessionId: ME, pausedFor: 'which' }).outcome).toBe('waits')
  })

  test('a step in the background starts waiting and keeps the work it left running', () => {
    const background = [{ callId: 'c1', taskId: 'w1', what: 'review' }]
    const plan = planOf(stepState({ ...run, background, is: 'noticing', turnId: 'n1' }))
    const made = decide(plan, { is: 'ask', sessionId: ME, pausedFor: 'which fix' })

    expect(made.plan.active?.is).toBe('asking')
    expect(made.plan.active?.background).toEqual(background)
  })

  test('a step continue or stop already ended is not asked again', () => {
    const plan = planOf(stepState({ ...run, is: 'closing', turnId: 't1' }))
    const made = decide(plan, { is: 'ask', sessionId: ME, pausedFor: 'which' })

    expect(made.outcome).toBe('ending')
    expect(made.plan).toBe(plan)
  })

  test('nothing is asked where no step runs, where its turn does not, or where it is another session\'s', () => {
    const cases: [string, Plan][] = [
      ['no step at all', planOf()],
      ['a step with no turn of its own', planOf(stepState({ ...run, is: 'waiting', pausedFor: 'earlier' }))],
      ['a step of another session', planOf(stepState({ ...run, sessionId: 'session-2', is: 'running', turnId: 't1' }))],
    ]
    for (const [what, plan] of cases) {
      const made = decide(plan, { is: 'ask', sessionId: ME, pausedFor: 'which' })
      expect(`${what}: ${made.outcome}`).toBe(`${what}: nothing`)
      expect(made.plan).toBe(plan)
    }
  })
})

describe('the work a step leaves running in the background', () => {
  const W1 = { callId: 'c1', taskId: 'w1', what: 'review' }
  const W2 = { callId: 'c2', taskId: 'a7', what: 'find the docs' }

  test("a call of the step's own turn makes its work the step's", () => {
    const plan = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const made = decide(plan, { is: 'workStarted', sessionId: ME, turnId: 't1', ...W1 })

    expect(made.outcome).toBe('noted')
    expect(made.plan.active?.background).toEqual([W1])
    expect(made.plan.active?.is).toBe('running')
  })

  test('work started outside the step\'s turn, or by another session, is not the step\'s', () => {
    const plan = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))

    expect(decide(plan, { is: 'workStarted', sessionId: ME, turnId: 'other', ...W1 }).outcome).toBe('nothing')
    expect(decide(plan, { is: 'workStarted', sessionId: 'session-2', turnId: 't1', ...W1 }).outcome).toBe('nothing')
    expect(decide(plan, { is: 'workStarted', sessionId: ME, turnId: undefined, ...W1 }).outcome).toBe('nothing')
  })

  test('the last work ending leaves no list behind, so the step waits for continue and not for work', () => {
    const plan = planOf(stepState({ ...run, background: [W1], is: 'away' }))
    const made = decide(plan, { is: 'workEnded', sessionId: ME, turnId: 'n1', taskId: 'w1' })

    expect(made.outcome).toBe('told')
    expect(made.plan.active?.is).toBe('noticing')
    // The record has to lose the key, not keep an empty list: the step is waiting on nobody.
    expect('background' in made.plan.active!).toBe(false)
  })

  test('with work still left the step stays away, keeping only what has not ended', () => {
    const plan = planOf(stepState({ ...run, background: [W1, W2], is: 'away' }))
    const made = decide(plan, { is: 'workEnded', sessionId: ME, turnId: 'n1', taskId: 'w1' })

    expect(made.plan.active?.is).toBe('noticing')
    expect(made.plan.active?.background).toEqual([W2])
  })

  test('a notification is matched by the call that started the work as well as by its task', () => {
    const plan = planOf(stepState({ ...run, background: [W1, W2], is: 'away' }))

    expect(decide(plan, { is: 'workEnded', sessionId: ME, callId: 'c2' }).plan.active?.background).toEqual([W1])
    expect(decide(plan, { is: 'workEnded', sessionId: ME, taskId: 'nothing-of-ours' }).outcome).toBe('nothing')
  })

  test("another session's step hears the work end but does not take the turn", () => {
    const plan = planOf(stepState({ ...run, sessionId: 'session-2', background: [W1], is: 'away' }))
    const made = decide(plan, { is: 'workEnded', sessionId: ME, turnId: 'n1', taskId: 'w1' })

    expect(made.outcome).toBe('quiet')
    expect(made.plan.active?.is).toBe('away')
  })

  test('work Claude stopped leaves the step at once, and the turn that stopped it is the step\'s', () => {
    const plan = planOf(stepState({ ...run, background: [W1], is: 'away' }))
    const made = decide(plan, { is: 'workStopped', sessionId: ME, turnId: 'h1', taskId: 'w1' })

    expect(made.plan.active?.is).toBe('noticing')
    expect(decide(plan, { is: 'workStopped', sessionId: ME, turnId: 'h1', taskId: 'other' }).outcome).toBe('nothing')
  })
})

describe("the turn of the step's own prompt starting", () => {
  test('a step waiting for its prompt starts running, and stamps when it began', () => {
    const plan = planOf(stepState({ ...run, is: 'due' }))
    const made = decide(plan, { is: 'bindTurn', sessionId: ME, turnId: 't1', now: 5000 })

    expect(made.outcome).toBe('bound')
    expect(made.plan.active?.is).toBe('running')
    expect(made.plan.active?.startedAt).toBe(5000)
  })

  test('a step that has run before keeps the time it began, not the time of this turn', () => {
    const plan = planOf(stepState({ ...run, startedAt: 100, is: 'waiting', pausedFor: 'which' }))

    expect(decide(plan, { is: 'bindTurn', sessionId: ME, turnId: 't2', now: 9000 }).plan.active?.startedAt).toBe(100)
  })

  test('the prompt that sums a run up takes an ending step to closing', () => {
    const plan = planOf(stepState({ ...run, is: 'ending' }))

    expect(decide(plan, { is: 'bindTurn', sessionId: ME, turnId: 't1', now: 1 }).plan.active?.is).toBe('closing')
  })

  test('a step whose turn already runs, or another session\'s, takes no turn here', () => {
    const mine = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const theirs = planOf(stepState({ ...run, sessionId: 'session-2', is: 'due' }))

    expect(decide(mine, { is: 'bindTurn', sessionId: ME, turnId: 't2', now: 1 }).outcome).toBe('nothing')
    expect(decide(theirs, { is: 'bindTurn', sessionId: ME, turnId: 't2', now: 1 }).outcome).toBe('nothing')
  })
})

describe('any other turn of this session starting', () => {
  const waiting = () => planOf(stepState({ ...run, is: 'waiting', pausedFor: 'may I push' }))

  test("an answer sent with the step's own words makes this the turn whose reply ends it", () => {
    const made = decide(waiting(), { is: 'bindAnswer', sessionId: ME, turnId: 'a1', isAnswer: true, isTold: true, isNotice: false })

    expect(made.outcome).toBe('bound')
    expect(made.plan.active?.is).toBe('answering')
  })

  test('an answer typed over a running turn leaves the step waiting for the next one', () => {
    const made = decide(waiting(), { is: 'bindAnswer', sessionId: ME, turnId: 'a1', isAnswer: true, isTold: false, isNotice: false })

    expect(made.plan.active).toEqual(stepState({ ...run, is: 'asking', turnId: 'a1', pausedFor: 'may I push', isAnswered: true }))
  })

  test('a turn of anything else takes the step but marks no answer', () => {
    const made = decide(waiting(), { is: 'bindAnswer', sessionId: ME, turnId: 'h1', isAnswer: false, isTold: false, isNotice: false })

    expect(made.plan.active?.is).toBe('asking')
    expect('isAnswered' in made.plan.active!).toBe(false)
  })

  test('an answer taken before this turn still counts, so the step says "answer again"', () => {
    const plan = planOf(stepState({ ...run, is: 'answered', pausedFor: 'may I push' }))
    const made = decide(plan, { is: 'bindAnswer', sessionId: ME, turnId: 'h1', isAnswer: false, isTold: false, isNotice: false })

    expect(made.plan.active).toEqual(stepState({ ...run, is: 'asking', turnId: 'h1', pausedFor: 'may I push', isAnswered: true }))
  })

  test('a step in the background takes the turn of its work\'s notice and no other', () => {
    const away = planOf(stepState({ ...run, background: [{ taskId: 'w1', what: 'review' }], is: 'away' }))
    const notice = { is: 'bindAnswer' as const, sessionId: ME, turnId: 'n1', isAnswer: false, isTold: false, isNotice: true }

    expect(decide(away, notice).plan.active?.is).toBe('noticing')
    expect(decide(away, { ...notice, isNotice: false }).outcome).toBe('nothing')
  })

  test('a step that is neither waiting nor away takes no turn, nor does another session\'s', () => {
    const running = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const theirs = planOf(stepState({ ...run, sessionId: 'session-2', is: 'waiting', pausedFor: 'x' }))
    const event = { is: 'bindAnswer' as const, sessionId: ME, turnId: 'h1', isAnswer: true, isTold: true, isNotice: false }

    expect(decide(running, event).outcome).toBe('nothing')
    expect(decide(theirs, event).outcome).toBe('nothing')
  })
})

describe('a run starting a step', () => {
  test('the step waits for its prompt, and the prompt is asked for after the band is counted', () => {
    const made = decide(planOf(), { is: 'start', sessionId: ME, index: 1, isChain: true })

    expect(made.outcome).toBe('started')
    expect(made.plan.active).toEqual(stepState({ step: 1, isChain: true, sessionId: ME, is: 'due' }))
    // The order is the move's, not the shell's: the band is counted before the prompt goes out.
    expect(made.does).toEqual([{ does: 'refreshBand' }, { does: 'sendStep', index: 1, isChain: true, isClosing: false }])
  })

  test('the steps /aside run named ride along to the prompt', () => {
    const made = decide(planOf(), { is: 'start', sessionId: ME, index: 0, isChain: false, then: [1] })

    expect(made.plan.active?.then).toEqual([1])
    expect(made.does[1]).toEqual({ does: 'sendStep', index: 0, isChain: false, then: [1], isClosing: false })
  })

  test('a step that starts ends any pause but its own', () => {
    const paused = { step: 0, reason: 'to organize the queue', isChain: true }
    const was = { ...planOf(), paused }

    expect(decide(was, { is: 'start', sessionId: ME, index: 1, isChain: true }).plan.paused).toBe(undefined)
    expect(decide(was, { is: 'start', sessionId: ME, index: 1, isChain: false, paused }).plan.paused).toEqual(paused)
  })

  test('a run takes over the step that was there, whoever was running it', () => {
    const theirs = planOf(stepState({ ...run, sessionId: 'session-2', is: 'running', turnId: 't1' }))
    const made = decide(theirs, { is: 'start', sessionId: ME, index: 1, isChain: true })

    expect(made.plan.active?.sessionId).toBe(ME)
    expect(made.plan.active?.step).toBe(1)
  })
})

describe('a step whose prompt never went out', () => {
  test('a step that continue or stop had ended is done as it stands, with the time it took', () => {
    const plan = planOf(stepState({ ...run, startedAt: 1000, result: 'half done', is: 'ending' }))
    const made = decide(plan, { is: 'promptDropped', index: 0, now: 61_000 })

    expect(made.outcome).toBe('ending')
    expect(made.plan.active).toBe(undefined)
    expect(made.plan.steps[0]).toEqual({ ...STEPS[0], isDone: true, ms: 60_000, doneAt: 61_000, result: 'half done' })
    // Done as it stands means the run stops there: no step follows it in.
    expect(made.plan.steps[1]?.isDone).toBe(undefined)
  })

  test('a step that never started is let go', () => {
    const made = decide(planOf(stepState({ ...run, is: 'due' })), { is: 'promptDropped', index: 0, now: 1 })

    expect(made.outcome).toBe('gone')
    expect(made.plan.active).toBe(undefined)
    expect(made.does).toEqual([{ does: 'refreshBand' }])
  })

  test('a step something else took the place of meanwhile is left alone', () => {
    const running = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const other = planOf(stepState({ step: 1, isChain: true, sessionId: ME, is: 'due' }))

    expect(decide(running, { is: 'promptDropped', index: 0, now: 1 }).outcome).toBe('nothing')
    expect(decide(other, { is: 'promptDropped', index: 0, now: 1 }).outcome).toBe('nothing')
    expect(decide(planOf(), { is: 'promptDropped', index: 0, now: 1 }).does).toEqual([])
  })
})

describe('/aside continue on a step it may end', () => {
  const OPEN = ['t1']

  test('the last step of a run of several takes one more turn, which sums the run up', () => {
    const plan = planOf(stepState({ step: 1, isChain: true, sessionId: ME, is: 'waiting', pausedFor: 'may I push' }))
    const made = decide(plan, { is: 'continue', sessionId: ME, now: 1, openTurns: [] })

    expect(made.outcome).toBe('closing')
    expect(made.plan.active?.is).toBe('ending')
    expect(made.does[1]).toEqual({ does: 'sendStep', index: 1, isChain: true, isClosing: true })
  })

  test('a step with more to follow is done and the next one starts in the same answer', () => {
    const plan = planOf(stepState({ ...run, is: 'waiting', pausedFor: 'x' }), [...STEPS, { title: 'Three', prompt: 'do three' }])
    const made = decide(plan, { is: 'continue', sessionId: ME, now: 1, openTurns: [] })

    expect(made.outcome).toBe('onward')
    expect(made.plan.steps[0]?.isDone).toBe(true)
    expect(made.plan.active?.step).toBe(1)
    expect(made.does[1]).toEqual({ does: 'sendStep', index: 1, isChain: true, isClosing: false })
  })

  test('a step run alone is done with nothing following it', () => {
    const plan = planOf(stepState({ ...run, isChain: false, is: 'away' }))
    const made = decide(plan, { is: 'continue', sessionId: ME, now: 1, openTurns: [] })

    expect(made.outcome).toBe('done')
    expect(made.plan.active).toBe(undefined)
  })

  test('a step an earlier process left running here may be ended, one running here may not', () => {
    const left = planOf(stepState({ ...run, isChain: false, is: 'running', turnId: 'gone' }))
    const mine = planOf(stepState({ ...run, isChain: false, is: 'running', turnId: 't1' }))
    const theirs = planOf(stepState({ ...run, sessionId: 'session-2', isChain: false, is: 'running', turnId: 'x' }))

    expect(decide(left, { is: 'continue', sessionId: ME, now: 1, openTurns: OPEN }).outcome).toBe('done')
    expect(decide(mine, { is: 'continue', sessionId: ME, now: 1, openTurns: OPEN }).outcome).toBe('nothing')
    expect(decide(theirs, { is: 'continue', sessionId: ME, now: 1, openTurns: OPEN }).outcome).toBe('nothing')
  })
})

describe('/aside stop', () => {
  test('a paused run with no step is dropped, and nothing at all answers nothing', () => {
    const paused = { ...planOf(), paused: { step: 0, reason: 'to organize the queue', isChain: true } }

    expect(decide(paused, { is: 'stop', sessionId: ME, now: 1, openTurns: [] }).outcome).toBe('dropped')
    expect(decide(paused, { is: 'stop', sessionId: ME, now: 1, openTurns: [] }).plan.paused).toBe(undefined)
    expect(decide(planOf(), { is: 'stop', sessionId: ME, now: 1, openTurns: [] }).outcome).toBe('nothing')
  })

  test('a step with no turn of its own is done as it stands, and says so when it said nothing', () => {
    const quiet = planOf(stepState({ ...run, is: 'waiting', pausedFor: 'x' }))
    const spoke = planOf(stepState({ ...run, result: 'half done', is: 'away' }))

    expect(decide(quiet, { is: 'stop', sessionId: ME, now: 5, openTurns: [] }).plan.steps[0]?.result).toBe('stopped')
    expect(decide(spoke, { is: 'stop', sessionId: ME, now: 5, openTurns: [] }).plan.steps[0]?.result).toBe('half done')
  })

  test('the step running here is made the last of its run', () => {
    const plan = planOf(stepState({ ...run, then: [1], is: 'running', turnId: 't1' }))
    const made = decide(plan, { is: 'stop', sessionId: ME, now: 1, openTurns: ['t1'] })

    expect(made.outcome).toBe('after')
    expect(made.plan.active?.isChain).toBe(false)
    expect(made.plan.active?.then).toBe(undefined)
    expect(made.plan.active?.is).toBe('running')
  })

  test('a step running here that had asked something is done once the turn it has left ends', () => {
    const plan = planOf(stepState({ ...run, is: 'asking', turnId: 't1', pausedFor: 'may I push' }))
    const made = decide(plan, { is: 'stop', sessionId: ME, now: 1, openTurns: ['t1'] })

    expect(made.plan.active).toEqual(stepState({ ...run, isChain: false, is: 'closing', turnId: 't1', pausedFor: 'may I push' }))
  })

  test('a step running in another session is let go, not ended', () => {
    const plan = planOf(stepState({ ...run, sessionId: 'session-2', is: 'running', turnId: 'x' }))
    const made = decide(plan, { is: 'stop', sessionId: ME, now: 1, openTurns: ['t1'] })

    expect(made.outcome).toBe('letGo')
    expect(made.plan.active).toBe(undefined)
    expect(made.plan.steps[0]?.isDone).toBe(undefined)
  })
})

describe("the end of the step's own turn", () => {
  const ended = (over: Partial<Extract<Parameters<typeof decide>[1], { is: 'turnEnded' }>> = {}) =>
    ({ is: 'turnEnded' as const, sessionId: ME, turnId: 't1', isAnswer: true, ms: 1000, answer: 'done it', now: 61_000, canOrganize: false, ...over })

  test('the step keeps the time the turn took and what its answer said it did', () => {
    const plan = planOf(stepState({ ...run, isChain: false, ms: 500, startedAt: 1000, is: 'running', turnId: 't1' }))
    const made = decide(plan, ended({ answer: 'looked around\n\nResult: two files changed' }))

    // The time by the clock, which is longer than the turn took, and the answer's own word.
    expect(made.plan.steps[0]).toEqual({ ...STEPS[0], isDone: true, ms: 60_000, doneAt: 61_000, result: 'two files changed' })
  })

  test('a step continue or stop ended is done when its turn ends, whatever ended it', () => {
    const plan = planOf(stepState({ ...run, is: 'closing', turnId: 't1', pausedFor: 'may I push' }))
    const made = decide(plan, ended({ isAnswer: false }))

    expect(made.outcome).toBe('done')
    expect(made.plan.active).toBe(undefined)
    expect(made.plan.steps[0]?.isDone).toBe(true)
    // Done as it stands: the step after it is not started.
    expect(made.plan.steps[1]?.isDone).toBe(undefined)
  })

  test('a question this turn did not answer leaves the step waiting for one, and says which', () => {
    const asking = planOf(stepState({ ...run, is: 'asking', turnId: 't1', pausedFor: 'which design' }))
    const again = planOf(stepState({ ...run, is: 'asking', turnId: 't1', pausedFor: 'which design', isAnswered: true }))
    const answering = planOf(stepState({ ...run, is: 'answering', turnId: 't1', pausedFor: 'which design' }))

    expect(decide(asking, ended()).outcome).toBe('waits')
    expect(decide(asking, ended()).plan.active).toEqual(stepState({ ...run, ms: 1000, result: 'done it', is: 'waiting', pausedFor: 'which design' }))
    // An answer taken before this turn, and one taken in a turn Claude asked again in, both
    // leave the step asking for another.
    expect(decide(again, ended()).plan.active?.is).toBe('answered')
    expect(decide(answering, ended({ isAnswer: false })).plan.active?.is).toBe('answered')
    expect(decide(asking, ended()).plan.steps[0]?.isDone).toBe(undefined)
  })

  test('the turn that took the answer ends the step, unless Claude asked again in it', () => {
    const plan = planOf(stepState({ ...run, isChain: false, is: 'answering', turnId: 't1', pausedFor: 'which design' }))

    expect(decide(plan, ended()).outcome).toBe('done')
    expect(decide(plan, ended()).plan.steps[0]?.isDone).toBe(true)
  })

  test('a turn of a step in the background cut short leaves it in the background', () => {
    const background = [{ callId: 'c1', taskId: 'w1', what: 'review' }]
    const plan = planOf(stepState({ ...run, background, is: 'noticing', turnId: 't1' }))
    const made = decide(plan, ended({ isAnswer: false }))

    expect(made.outcome).toBe('away')
    expect(made.plan.active).toEqual(stepState({ ...run, ms: 1000, background, is: 'away' }))
  })

  test('a turn that is no answer at all leaves no step, and none of it done', () => {
    const plan = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const made = decide(plan, ended({ isAnswer: false }))

    expect(made.outcome).toBe('stopped')
    expect(made.plan.active).toBe(undefined)
    expect(made.plan.steps[0]?.isDone).toBe(undefined)
  })

  test('work a turn of the step started and still running keeps the step there', () => {
    const background = [{ taskId: 'w1', what: 'review' }]
    const plan = planOf(stepState({ ...run, background, is: 'running', turnId: 't1' }))
    const made = decide(plan, ended())

    expect(made.outcome).toBe('away')
    expect(made.plan.active).toEqual(stepState({ ...run, ms: 1000, result: 'done it', background, is: 'away' }))
    expect(made.plan.steps[0]?.isDone).toBe(undefined)
  })

  test('a step done with more to follow is done and the next one starts in the same answer', () => {
    const plan = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const made = decide(plan, ended())

    expect(made.outcome).toBe('onward')
    expect(made.plan.active).toEqual(stepState({ step: 1, isChain: true, sessionId: ME, is: 'due' }))
    expect(made.does).toEqual([{ does: 'refreshBand' }, { does: 'sendStep', index: 1, isChain: true, isClosing: false }])
  })

  test('with the queue to organize first, the run waits after the step for /aside continue', () => {
    const plan = planOf(stepState({ ...run, isPlanningAfter: true, is: 'running', turnId: 't1' }))
    const made = decide(plan, ended({ canOrganize: true }))

    expect(made.outcome).toBe('pausing')
    expect(made.plan.active).toBe(undefined)
    expect(made.plan.paused).toEqual({ step: 0, reason: 'to organize the queue', isChain: true })
    expect(made.does).toEqual([{ does: 'refreshBand' }, { does: 'organize', isAdding: true }])
  })

  test('the queue a step asked to organize goes to Claude once that step has ended on an answer', () => {
    const one = [{ title: 'One', prompt: 'do one' }]
    const alone = planOf(stepState({ ...run, isChain: false, isPlanningAfter: true, is: 'running', turnId: 't1' }), one)
    const cut = planOf(stepState({ ...run, isChain: false, isPlanningAfter: true, is: 'running', turnId: 't1' }), one)

    // Nothing of the plan is left to add to, so the queue is organized as a plan of its own.
    expect(decide(alone, ended({ canOrganize: true })).does).toEqual([{ does: 'refreshBand' }, { does: 'organize', isAdding: false }])
    // A step cut short organizes nothing: the toast tells the person /aside plan does it.
    expect(decide(cut, ended({ canOrganize: true, isAnswer: false })).does).toEqual([{ does: 'refreshBand' }])
  })

  test("a step away, or one whose question stands, has not ended, so it organizes nothing", () => {
    const background = [{ taskId: 'w1', what: 'review' }]
    const away = planOf(stepState({ ...run, background, isPlanningAfter: true, is: 'running', turnId: 't1' }))
    const asking = planOf(stepState({ ...run, isPlanningAfter: true, is: 'asking', turnId: 't1', pausedFor: 'which' }))

    expect(decide(away, ended({ canOrganize: true })).does).toEqual([{ does: 'refreshBand' }, { does: 'watchWork', step: 0 }])
    // The request goes with the turn it was asked in, so the step that waits no longer holds it.
    expect(decide(asking, ended({ canOrganize: true })).plan.active?.isPlanningAfter).toBe(undefined)
    expect(decide(asking, ended({ canOrganize: true })).does).toEqual([{ does: 'refreshBand' }, { does: 'organize', isAdding: true }])
  })

  test('no other turn ends the step: not another session\'s, not one it never had', () => {
    const plan = planOf(stepState({ ...run, is: 'running', turnId: 't1' }))
    const theirs = planOf(stepState({ ...run, sessionId: 'session-2', is: 'running', turnId: 't1' }))
    const waiting = planOf(stepState({ ...run, is: 'waiting', pausedFor: 'x' }))
    const none = planOf()

    expect(decide(plan, ended({ turnId: 't2' })).outcome).toBe('nothing')
    expect(decide(theirs, ended()).outcome).toBe('nothing')
    expect(decide(waiting, ended()).outcome).toBe('nothing')
    expect(decide(none, ended()).plan).toBe(none)
  })
})

describe('a turn that will never end', () => {
  const W1 = { callId: 'c1', taskId: 'w1', what: 'review' }
  const died = (over: Partial<Extract<Parameters<typeof decide>[1], { is: 'turnDied' }>> = {}) =>
    ({ is: 'turnDied' as const, sessionId: ME, turnId: undefined, isGone: false, openTurns: ['t1'], ownWork: [], now: 61_000, ...over })

  test('a step whose turn this process left open waits for the person, saying its turn ended', () => {
    const plan = planOf(stepState({ ...run, startedAt: 1000, is: 'running', turnId: 't1' }))
    const made = decide(plan, died({ turnId: 't2' }))

    expect(made.outcome).toBe('waits')
    expect(made.plan.active).toEqual(stepState({ ...run, startedAt: 1000, is: 'waiting', pausedFor: 'its turn ended without an answer' }))
    expect(made.does).toEqual([{ does: 'refreshBand' }])
    expect(made.plan.steps[0]?.isDone).toBe(undefined)
  })

  test('the question it asked stands in place of that, and an answer it took leaves it asked again', () => {
    const asking = planOf(stepState({ ...run, is: 'asking', turnId: 't1', pausedFor: 'which design' }))
    const answering = planOf(stepState({ ...run, is: 'answering', turnId: 't1', pausedFor: 'which design' }))

    expect(decide(asking, died()).plan.active).toEqual(stepState({ ...run, is: 'waiting', pausedFor: 'which design' }))
    expect(decide(answering, died()).plan.active).toEqual(stepState({ ...run, is: 'answered', pausedFor: 'which design' }))
  })

  test('a step continue or stop had ended is done as it stands, and says nothing', () => {
    const closing = planOf(stepState({ ...run, is: 'closing', turnId: 't1', pausedFor: 'may I push' }))
    const ending = planOf(stepState({ ...run, is: 'ending' }))

    expect(decide(closing, died()).outcome).toBe('done')
    expect(decide(closing, died()).plan.steps[0]?.isDone).toBe(true)
    // With no turn to lose, only the session's own end reaches it.
    expect(decide(ending, died()).outcome).toBe('nothing')
    expect(decide(ending, died({ isGone: true })).plan.steps[0]?.isDone).toBe(true)
  })

  test('a step in the background goes back to waiting on its work, which a session gone lets go', () => {
    const noticing = planOf(stepState({ ...run, background: [W1], is: 'noticing', turnId: 't1' }))
    const away = planOf(stepState({ ...run, background: [W1], is: 'away' }))

    expect(decide(noticing, died()).outcome).toBe('away')
    expect(decide(noticing, died()).plan.active).toEqual(stepState({ ...run, background: [W1], is: 'away' }))
    // The session that ended is the one whose call left that work running: both go.
    const gone = decide(away, died({ isGone: true, ownWork: ['c1'] }))
    expect(gone.outcome).toBe('waits')
    expect(gone.plan.active).toEqual(stepState({ ...run, is: 'waiting', pausedFor: 'its turn ended without an answer' }))
  })

  test('the request to organize the queue goes with the turn it was asked in', () => {
    const plan = planOf(stepState({ ...run, isPlanningAfter: true, is: 'running', turnId: 't1' }))

    expect(decide(plan, died()).plan.active?.isPlanningAfter).toBe(undefined)
  })

  test('what another process runs is left to it, and so is a step already where it would land', () => {
    const cases: [string, Plan, Partial<Extract<Parameters<typeof decide>[1], { is: 'turnDied' }>>][] = [
      ['the turn running now', planOf(stepState({ ...run, is: 'running', turnId: 't1' })), { turnId: 't1' }],
      ['a turn this process never saw start', planOf(stepState({ ...run, is: 'running', turnId: 'elsewhere' })), {}],
      ['a step of another session', planOf(stepState({ ...run, sessionId: 'session-2', is: 'running', turnId: 't1' })), {}],
      ['a step that waits for the person already', planOf(stepState({ ...run, is: 'waiting', pausedFor: 'x' })), { isGone: true }],
      ['work another process left running', planOf(stepState({ ...run, background: [{ taskId: 'w1', what: 'review' }], is: 'away' })), { isGone: true }],
      ['no step at all', planOf(), {}],
    ]
    for (const [what, plan, over] of cases) {
      const made = decide(plan, died(over))
      expect(`${what}: ${made.outcome}`).toBe(`${what}: nothing`)
      expect(made.plan).toBe(plan)
    }
  })
})
