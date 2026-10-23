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
