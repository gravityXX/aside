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
