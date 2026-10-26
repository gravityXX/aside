import { describe, expect, test } from 'claude-code/testing'

import type { StepRun, StepState, StoredActive } from '../types'
import type { Where } from '../hooks/core/step'
import { askedOf, canFollow, FOLLOWS, isAway, isWaiting, mustFollow, readActive, storedActive, turnOf, whereOf } from '../hooks/core/step'

// How the marks the store keeps become the step's state and go back again (2.7). These are
// rules over every combination the store can hold, not only those a release writes, so each
// case is a row of a table rather than something the person sees (6.3).

// The ten states, so a new one has to be named here before it can pass.
const STATES = ['due', 'running', 'asking', 'answering', 'waiting', 'answered', 'noticing', 'away', 'ending', 'closing']

// The states that only make sense with a turn of the step running, and those that only make
// sense without one.
const WITH_TURN = ['running', 'asking', 'answering', 'noticing', 'closing']
const WITHOUT_TURN = ['due', 'waiting', 'answered', 'away', 'ending']

// Two shapes of what the step carries: the least a record can hold, and every field at once.
const RUNS: StepRun[] = [
  { step: 0, isChain: true, sessionId: 's' },
  {
    step: 2,
    isChain: false,
    sessionId: 's',
    then: [3, 4],
    ms: 1000,
    result: 'half done',
    startedAt: 50,
    isPlanningAfter: true,
    background: [{ callId: 'c1', taskId: 't1', what: 'review' }],
  },
]

// Every combination of the marks an earlier release could have written, the ones no release
// writes any more included.
const stored = (): StoredActive[] => {
  const all: StoredActive[] = []
  for (const run of RUNS) {
    for (const turnId of [undefined, 'turn-1']) {
      for (const pausedFor of [undefined, 'which design']) {
        for (const isAnswered of [undefined, true as const]) {
          for (const answerTurnId of [undefined, 'turn-1', 'turn-0']) {
            for (const isEnding of [undefined, true as const]) {
              for (const isAway of [undefined, true as const]) {
                all.push({
                  ...run,
                  ...(turnId === undefined ? {} : { turnId }),
                  ...(pausedFor === undefined ? {} : { pausedFor }),
                  ...(isAnswered === undefined ? {} : { isAnswered }),
                  ...(answerTurnId === undefined ? {} : { answerTurnId }),
                  ...(isEnding === undefined ? {} : { isEnding }),
                  ...(isAway === undefined ? {} : { isAway }),
                })
              }
            }
          }
        }
      }
    }
  }

  return all
}

describe('the step running, read from the marks the store keeps', () => {
  test('every combination the store can hold reads as one of the ten states', () => {
    const seen = new Set<string>()
    for (const one of stored()) {
      const state = readActive(one)
      expect(STATES).toContain(state.is)
      seen.add(state.is)
    }

    // Every state is reachable from some record, so none of the ten is dead.
    expect([...seen].sort()).toEqual([...STATES].sort())
  })

  test('a state carries a turn when it has one to carry, and the question when it waits', () => {
    for (const one of stored()) {
      const state = readActive(one)
      if (WITH_TURN.includes(state.is)) expect(turnOf(state)).toBe(one.turnId)
      if (WITHOUT_TURN.includes(state.is)) expect(turnOf(state)).toBe(undefined)
      if (isWaiting(state)) expect(typeof state.pausedFor).toBe('string')
      // Only the one state that goes on in the background reads as away.
      expect(isAway(state)).toBe(state.is === 'away')
    }
  })

  test('what aside writes back is read as the state it wrote, with the keys in the same order', () => {
    for (const one of stored()) {
      const state = readActive(one)
      const again = readActive(storedActive(state))

      // The state survives the trip to the store and back, field for field.
      expect(again).toEqual(state)
      // And key for key: changePlan writes only when JSON.stringify of the plan moved, and
      // savePlanSteps drops a planner's whole save when the plan no longer stringifies the
      // same, so two spellings of one state would cost a write or a plan (2.10).
      expect(JSON.stringify(again)).toBe(JSON.stringify(state))
    }
  })

  test('the marks written back are read the same way a second time', () => {
    for (const one of stored()) {
      const once = storedActive(readActive(one))
      const twice = storedActive(readActive(once))

      expect(twice).toEqual(once)
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    }
  })

  test('a state keeps what the run carries and nothing of the marks it is not in', () => {
    for (const one of stored()) {
      const state: StepState = readActive(one)
      expect(state.step).toBe(one.step)
      expect(state.isChain).toBe(one.isChain)
      expect(state.sessionId).toBe(one.sessionId)
      expect(state.then).toEqual(one.then)
      expect(state.ms).toBe(one.ms)
      expect(state.result).toBe(one.result)
      expect(state.startedAt).toBe(one.startedAt)
      expect(state.isPlanningAfter).toBe(one.isPlanningAfter)
      expect(state.background).toEqual(one.background)
      // The marks themselves are gone: the state says what they stood for.
      for (const mark of ['isAnswered', 'answerTurnId', 'isEnding', 'isAway']) {
        if (!(mark === 'isAnswered' && state.is === 'asking')) expect(mark in state).toBe(false)
      }
      // A question is kept only where the state has one to keep.
      const asks = ['asking', 'answering', 'waiting', 'answered', 'ending', 'closing'].includes(state.is)
      expect(askedOf(state)).toBe(asks ? one.pausedFor : undefined)
    }
  })
})

// The graph the writers make between them, held to the shape a run has to have: every state is
// reached from somewhere, and from every state a run can end. A state nothing reaches would be
// dead, and one that cannot reach `none` would be a step no command could finish.
describe('where the step running can go', () => {
  const WHERE: Where[] = [...STATES, 'none'] as Where[]

  test('the graph names every state and nothing else', () => {
    expect(Object.keys(FOLLOWS).sort()).toEqual([...WHERE].sort())
    for (const [from, tos] of Object.entries(FOLLOWS)) {
      expect(WHERE).toContain(from)
      for (const to of tos) {
        expect(WHERE).toContain(to)
        // A state is never listed against itself: a change that moves nothing is no move.
        expect(to).not.toBe(from)
      }
    }
  })

  test('every state is reached from a run starting, and from every state a run can end', () => {
    const walk = (start: Where, next: (one: Where) => readonly Where[]) => {
      const seen = new Set<Where>([start])
      for (const one of seen) for (const to of next(one)) seen.add(to)

      return seen
    }
    const forward = walk('none', one => FOLLOWS[one])
    expect([...forward].sort()).toEqual([...WHERE].sort())

    const back = walk('none', one => WHERE.filter(other => FOLLOWS[other].includes(one)))
    expect([...back].sort()).toEqual([...WHERE].sort())
  })

  test('a move the graph does not have is refused, and standing still is not a move', () => {
    expect(canFollow('due', 'running')).toBe(true)
    expect(canFollow('running', 'running')).toBe(true)
    expect(canFollow('due', 'ending')).toBe(false)
    expect(canFollow('closing', 'asking')).toBe(false)
    expect(canFollow('none', 'running')).toBe(false)
  })

  test('where a plan is read off it, and a move it may not make throws by the same words', () => {
    const active = readActive({ step: 0, isChain: false, sessionId: 'session-1', turnId: 't1' })

    expect(whereOf({ steps: [] })).toBe('none')
    expect(whereOf({ steps: [], active })).toBe('running')
    expect(() => mustFollow('due', 'running')).not.toThrow()
    // Both `decide` and changePlan refuse by this, so the sentence a hook shows is the same
    // wherever the move was made.
    expect(() => mustFollow('due', 'ending')).toThrow('a step cannot go from due to ending')
  })
})
